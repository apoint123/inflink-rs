import log from "loglevel";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const originalFactory = log.methodFactory;

log.methodFactory = (methodName, level, loggerName) => {
	const rawMethod = originalFactory(methodName, level, loggerName);

	return (...args: unknown[]) => {
		const [firstArg, secondArg, ...rest] = args;
		const pluginPart = `InfLink FE`;

		if (typeof secondArg === "string") {
			const badgePluginCss = [
				"color: white",
				"background-color: #007bff",
				"padding: 1px 4px",
				"border-radius: 3px 0 0 3px",
				"font-weight: bold",
			].join(";");
			const badgeSourceCss = [
				"color: white",
				"background-color: #5a6268",
				"padding: 1px 4px",
				"border-radius: 0 3px 3px 0",
			].join(";");

			rawMethod(
				`%c${pluginPart}%c${secondArg}`,
				badgePluginCss,
				badgeSourceCss,
				firstArg,
				...rest,
			);
		} else {
			const badgeCss = [
				"color: white",
				"background-color: #007bff",
				"padding: 1px 4px",
				"border-radius: 3px",
				"font-weight: bold",
			].join(";");
			rawMethod(`%c${pluginPart}`, badgeCss, ...args);
		}
	};
};

const logger = log.getLogger("InfLink FE");
logger.setLevel("warn");

export function setLogLevel(level: LogLevel) {
	logger.setLevel(level);
}

export default logger;
