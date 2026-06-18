import { GameSession } from "./application/game-session.js";
import { IndexedDbGameRepository } from "./infrastructure/persistence/indexeddb-game-repository.js";
import { renderApp } from "./ui/app.js";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (root === null) throw new Error("Missing #app root.");

void renderApp(root, { session: new GameSession(new IndexedDbGameRepository()) });
