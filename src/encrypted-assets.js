(function () {
  "use strict";

  const manifestElement = document.getElementById("encrypted-asset-manifest");
  const hashedPassword = window.__encryptedAssetKey;
  delete window.__encryptedAssetKey;
  if (!manifestElement || !hashedPassword) return;

  const manifest = JSON.parse(manifestElement.textContent);
  const entries = new Map(manifest.entries.map((entry) => [entry.url, entry]));
  const objectUrls = new Set();
  const pending = new Map();
  const encoder = new TextEncoder();

  function hexBytes(value) {
    const bytes = new Uint8Array(value.length / 2);
    for (let index = 0; index < value.length; index += 2) bytes[index / 2] = parseInt(value.slice(index, index + 2), 16);
    return bytes;
  }

  async function assetKey() {
    const material = await crypto.subtle.importKey("raw", hexBytes(hashedPassword), "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({
      name: "HKDF", hash: "SHA-256", salt: encoder.encode(manifest.salt),
      info: encoder.encode("rackodej/encrypted-assets/v1"),
    }, material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }

  const keyPromise = assetKey();

  async function decryptUrl(url) {
    if (pending.has(url)) return pending.get(url);
    const task = (async () => {
      const entry = entries.get(url);
      if (!entry) throw new Error("Unknown encrypted asset");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Encrypted asset request failed: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length < 33 || String.fromCharCode(...bytes.slice(0, 4)) !== "RAE1") throw new Error("Invalid encrypted asset");
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(4, 16) }, await keyPromise, bytes.slice(16)
      );
      const objectUrl = URL.createObjectURL(new Blob([plaintext], { type: entry.mime }));
      objectUrls.add(objectUrl);
      return { entry, objectUrl };
    })();
    pending.set(url, task);
    return task;
  }

  function report(error) {
    console.error(error);
    document.documentElement.dataset.encryptedAssetError = "true";
  }

  for (const attribute of ["src", "poster"]) {
    document.querySelectorAll(`[data-encrypted-${attribute}]`).forEach(async (element) => {
      try {
        const result = await decryptUrl(element.dataset[`encrypted${attribute[0].toUpperCase()}${attribute.slice(1)}`]);
        element.setAttribute(attribute, result.objectUrl);
        element.removeAttribute(`data-encrypted-${attribute}`);
        if (element.tagName === "SOURCE" && element.parentElement && element.parentElement.load) element.parentElement.load();
      } catch (error) { report(error); }
    });
  }

  document.querySelectorAll("[data-encrypted-srcset]").forEach(async (element) => {
    try {
      const sources = JSON.parse(atob(element.dataset.encryptedSrcset));
      const resolved = await Promise.all(sources.map(async (source) => {
        const result = await decryptUrl(source.url);
        return `${result.objectUrl}${source.descriptor ? ` ${source.descriptor}` : ""}`;
      }));
      element.srcset = resolved.join(", ");
      element.removeAttribute("data-encrypted-srcset");
    } catch (error) { report(error); }
  });

  document.querySelectorAll("a[data-encrypted-href]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        const result = await decryptUrl(link.dataset.encryptedHref);
        if (result.entry.kind === "files" || link.hasAttribute("download")) {
          const download = document.createElement("a");
          download.href = result.objectUrl;
          download.download = result.entry.name;
          download.click();
        } else if (link.target === "_blank") {
          window.open(result.objectUrl, "_blank", "noopener");
        } else {
          window.location.assign(result.objectUrl);
        }
      } catch (error) { report(error); }
    });
  });

  window.addEventListener("pagehide", () => objectUrls.forEach((url) => URL.revokeObjectURL(url)), { once: true });
})();
