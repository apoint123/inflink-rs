import log from "loglevel";

const logger = log.getLogger("InfLink frontend");

logger.setLevel("info");

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export function setLogLevel(level: LogLevel) {
	logger.setLevel(level);
}

export default logger;
