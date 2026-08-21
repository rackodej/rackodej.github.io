(function () {
  function parseCards(root) {
    const source = root.querySelector(".anki-cards__data");
    if (!source) return [];
    try {
      const cards = JSON.parse(source.textContent || "[]");
      return Array.isArray(cards) ? cards : [];
    } catch {
      return [];
    }
  }

  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  function setup(root) {
    const cards = parseCards(root);
    if (!cards.length) return;

    let index = 0;
    let answerVisible = false;

    const counter = root.querySelector("[data-anki-counter]");
    const question = root.querySelector("[data-anki-question]");
    const answerBlock = root.querySelector("[data-anki-answer-block]");
    const answer = root.querySelector("[data-anki-answer]");
    const showButton = root.querySelector('[data-anki-action="show-answer"]');

    function render() {
      const card = cards[index];
      counter.textContent = `${index + 1} / ${cards.length}`;
      question.textContent = card.question || "";
      answer.textContent = card.answer || "";
      answerBlock.hidden = !answerVisible;
      showButton.textContent = answerVisible ? showButton.dataset.labelHide : showButton.dataset.labelShow;
    }

    function move(delta) {
      index = (index + delta + cards.length) % cards.length;
      answerVisible = false;
      render();
    }

    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-anki-action]");
      if (!button || !root.contains(button)) return;

      if (button.dataset.ankiAction === "show-answer") {
        answerVisible = !answerVisible;
        render();
      }
      if (button.dataset.ankiAction === "prev") move(-1);
      if (button.dataset.ankiAction === "next") move(1);
      if (button.dataset.ankiAction === "shuffle") {
        shuffle(cards);
        index = 0;
        answerVisible = false;
        render();
      }
    });

    render();
  }

  document.querySelectorAll(".anki-cards").forEach(setup);
})();
