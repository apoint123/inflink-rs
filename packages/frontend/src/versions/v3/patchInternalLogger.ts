import { findModule, type WebpackRequire } from "@/utils";
import logger from "@/utils/logger";

export function patchInternalLogger(
	require: WebpackRequire,
	checkLoggingEnabled: () => boolean,
): void {
	try {
		type LoggerMethod = (...args: unknown[]) => void;
		type PatchedLoggerMethod = LoggerMethod & { __isPatched?: boolean };
		type LoggerModule = {
			[level in
				| "debug"
				| "log"
				| "info"
				| "warn"
				| "error"
				| "crash"]: LoggerMethod;
		};
		type LoggerContainer = { b: LoggerModule };

		type PatchableConsoleLevel = "debug" | "log" | "info" | "warn" | "error";

		const loggerContainer = findModule<LoggerContainer>(
			require,
			(exports: unknown): exports is LoggerContainer =>
				!!exports &&
				typeof exports === "object" &&
				"b" in exports &&
				!!(exports as { b: unknown }).b &&
				typeof (exports as { b: object }).b === "object" &&
				"info" in (exports as { b: object }).b &&
				typeof (exports as { b: { info: unknown } }).b.info === "function",
		);

		if (!loggerContainer) {
			logger.warn("未找到内部日志模块，跳过补丁", "Adapter V3");
			return;
		}

		const loggerModule = loggerContainer.b;
		const levelsToPatch: PatchableConsoleLevel[] = [
			"debug",
			"log",
			"info",
			"warn",
			"error",
		];

		for (const level of levelsToPatch) {
			const originalMethod = loggerModule[level] as PatchedLoggerMethod;

			if (originalMethod.__isPatched) {
				continue;
			}

			const newMethod: PatchedLoggerMethod = (...args: unknown[]) => {
				if (checkLoggingEnabled()) {
					const [modName, ...restArgs] = args;

					const pluginPart = "NCM Internal";
					const sourcePart = String(modName);
					const badgePluginCss = [
						"color: white",
						"background-color: #ff3f41",
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

					console[level](
						`%c${pluginPart}%c${sourcePart}`,
						badgePluginCss,
						badgeSourceCss,
						...restArgs,
					);
				}
				return originalMethod.apply(loggerModule, args);
			};
			newMethod.__isPatched = true;

			loggerModule[level] = newMethod;
		}
	} catch (e) {
		logger.error("给内部日志模块打补丁时发生错误:", "Adapter V3", e);
	}
}
