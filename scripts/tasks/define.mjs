const REQUIRED_FIELDS = ["name", "description", "kind", "ci", "requires", "timeoutClass", "run"];

/**
 * @typedef {{ type: "command", command: string, args: string[] }
 *   | { type: "series", tasks: string[] }
 *   | { type: "suite", suite: string }
 *   | { type: "pipeline", pipeline: string }} TaskRun
 * @typedef {object} Task
 * @property {string} name
 * @property {string} description
 * @property {string} kind
 * @property {boolean} ci
 * @property {string[]} requires
 * @property {string} timeoutClass
 * @property {TaskRun} run
 */

/** @param {Task} task @returns {Readonly<Task>} */
export function defineTask(task) {
  for (const field of REQUIRED_FIELDS) {
    if (task[/** @type {keyof Task} */ (field)] === undefined) {
      throw new Error(`Task definition is missing ${field}: ${task.name ?? "<unnamed>"}`);
    }
  }
  return Object.freeze(task);
}

/**
 * @param {Omit<Task, "run"> & { command: string, args?: string[] }} definition
 * @returns {Readonly<Task>}
 */
export function commandTask({ command, args = [], ...metadata }) {
  return defineTask({ ...metadata, run: { type: "command", command, args } });
}

/**
 * @param {Omit<Task, "run"> & { tasks: string[] }} definition
 * @returns {Readonly<Task>}
 */
export function seriesTask({ tasks, ...metadata }) {
  return defineTask({ ...metadata, run: { type: "series", tasks } });
}

/**
 * @param {Omit<Task, "run"> & { suite: string }} definition
 * @returns {Readonly<Task>}
 */
export function suiteTask({ suite, ...metadata }) {
  return defineTask({ ...metadata, run: { type: "suite", suite } });
}

/**
 * @param {Omit<Task, "run"> & { pipeline: string }} definition
 * @returns {Readonly<Task>}
 */
export function pipelineTask({ pipeline, ...metadata }) {
  return defineTask({ ...metadata, run: { type: "pipeline", pipeline } });
}
