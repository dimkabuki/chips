import { GameSession } from "./application/game-session.js";
import { IndexedDbGameRepository } from "./infrastructure/persistence/indexeddb-game-repository.js";
import { renderApp } from "./ui/app.js";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (root === null) throw new Error("Missing #app root.");

void renderApp(root, { session: new GameSession(new IndexedDbGameRepository()) });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  });
}
