// Hilo de trabajo del simulador: recibe una tarea (un puzzle con sus partidas) y devuelve sus
// registros.
import { parentPort } from "node:worker_threads";
import { runTask, type SimTask } from "./run.ts";

const port = parentPort;
if (!port) throw new Error("worker.ts must run as a worker thread");
port.on("message", (task: SimTask) => {
  port.postMessage(runTask(task));
});
