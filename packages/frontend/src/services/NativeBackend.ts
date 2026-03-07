import type {
	AppMessage,
	CommandResult,
	ControlMessage,
	DiscordConfigPayload,
	LogEntry,
	MetadataPayload,
	PlaybackStatus,
	RepeatMode,
	SmtcEvent,
} from "../types/backend";
import type { LogLevel } from "../utils/logger";
import logger from "../utils/logger";

const NATIVE_API_PREFIX = "inflink.";

interface NativeApiMap {
	initialize: (args?: []) => void;
	terminate: (args?: []) => void;
	registerLogger: (args: [callback: (logJson: string) => void]) => void;
	registerEventCallback: (
		args: [callback: (eventJson: string) => void],
	) => void;
	setLogLevel: (args: [level: LogLevel]) => void;
	dispatch: (args: [commandJson: string]) => string;
}

const ALL_LOG_LEVELS: Readonly<LogLevel[]> = [
	"error",
	"warn",
	"info",
	"debug",
	"trace",
];

function isLogLevel(level: string): level is LogLevel {
	return ALL_LOG_LEVELS.some((l) => l === level);
}

class NativeBackend {
	private isActive = false;

	private call<K extends keyof NativeApiMap>(
		func: K,
		...args: Parameters<NativeApiMap[K]>
	): ReturnType<NativeApiMap[K]> {
		const nativeArgs = args[0] ?? [];
		return betterncm_native.native_plugin.call<ReturnType<NativeApiMap[K]>>(
			`${NATIVE_API_PREFIX}${func}`,
			nativeArgs,
		);
	}

	private dispatch<T extends keyof AppMessage>(
		type: T,
		payload: AppMessage[T],
	) {
		const command = JSON.stringify({ type, payload });
		const resultJson = this.call("dispatch", [command]);

		if (!resultJson) {
			logger.error(`命令 '${type}' 未收到任何返回结果。`, "Native Bridge");
			return;
		}

		try {
			const result: CommandResult = JSON.parse(resultJson);
			if (result.status === "Error") {
				logger.error(
					`后端执行命令 '${type}' 时发生错误:`,
					"Native Bridge",
					result.message,
				);
			}
		} catch (e) {
			logger.error(
				`解析后端返回结果失败:`,
				"Native Bridge",
				e,
				"\n原始结果:",
				resultJson,
			);
		}
	}

	public initialize(control_handler: (msg: ControlMessage) => void) {
		if (this.isActive) return;
		this.call("terminate");

		this.isActive = true;
		this.registerLogger();
		this.call("initialize");

		window.addEventListener("beforeunload", () => {
			if (this.isActive) {
				this.disableDiscordRpc();
				this.disableSmtcSession();
				this.call("terminate");
			}
		});

		const eventCallback = (eventJson: string) => {
			try {
				const event: SmtcEvent = JSON.parse(eventJson);
				control_handler(event);
			} catch (e) {
				logger.error("解析后端事件失败:", "Native Bridge", e);
			}
		};

		this.call("registerEventCallback", [eventCallback]);
	}

	public setBackendLogLevel(level: LogLevel) {
		this.call("setLogLevel", [level]);
		logger.info(`设置后端日志级别为: ${level}`, "Native Bridge");
	}

	private registerLogger() {
		const logCallback = (logJson: string) => {
			try {
				const entry: LogEntry = JSON.parse(logJson);
				const level = entry.level.toLowerCase();

				if (!isLogLevel(level)) {
					logger.log(`[InfLink BE|${entry.target}] ${entry.message}`);
					return;
				}

				const pluginPart = "InfLink BE";
				const sourcePart = entry.target;

				const badgePluginCss = [
					"color: white",
					"background-color: #946143ff",
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

				const logMethod = console[level] ?? console.log;
				logMethod(
					`%c${pluginPart}%c${sourcePart}`,
					badgePluginCss,
					badgeSourceCss,
					entry.message,
				);
			} catch (e) {
				logger.error("解析后端日志失败:", "Native Bridge", e);
			}
		};
		this.call("registerLogger", [logCallback]);
	}

	public disable() {
		if (!this.isActive) return;
		this.isActive = false;

		this.call("terminate");
		logger.info("已终止后端", "Native Bridge");
	}

	public enableSmtcSession() {
		if (!this.isActive) return;
		this.dispatch("EnableSmtc", undefined);
		logger.info("启用 SMTC 会话", "Native Bridge");
	}

	public disableSmtcSession() {
		if (!this.isActive) return;
		this.dispatch("DisableSmtc", undefined);
		logger.info("禁用 SMTC 会话", "Native Bridge");
	}

	public enableDiscordRpc() {
		if (!this.isActive) return;
		this.dispatch("EnableDiscord", undefined);
		logger.info("启用 Discord RPC", "Native Bridge");
	}

	public disableDiscordRpc() {
		if (!this.isActive) return;
		this.dispatch("DisableDiscord", undefined);
		logger.info("禁用 Discord RPC", "Native Bridge");
	}

	public updateDiscordConfig(config: DiscordConfigPayload) {
		if (!this.isActive) return;
		this.dispatch("DiscordConfig", config);
		logger.debug(`更新 Discord 配置`, "Native Bridge", config);
	}

	public update(songInfo: MetadataPayload) {
		this.dispatch("UpdateMetadata", songInfo);
	}

	public updatePlayState(status: PlaybackStatus) {
		this.dispatch("UpdatePlayState", { status });
	}

	public updateTimeline(timeline: { currentTime: number; totalTime: number }) {
		this.dispatch("UpdateTimeline", timeline);
	}

	public updatePlayMode(playMode: {
		isShuffling: boolean;
		repeatMode: RepeatMode;
	}) {
		this.dispatch("UpdatePlayMode", playMode);
	}
}

export const NativeBackendInstance = new NativeBackend();
