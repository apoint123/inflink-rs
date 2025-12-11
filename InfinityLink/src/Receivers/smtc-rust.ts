import type {
	CommandResult,
	ControlMessage,
	DiscordConfigPayload,
	LogEntry,
	MetadataPayload,
	PlaybackStatus,
	RepeatMode,
	SmtcCommandPayloads,
	SmtcEvent,
} from "../types/smtc";
import type { LogLevel } from "../utils/logger";
import logger from "../utils/logger";

const NATIVE_API_PREFIX = "inflink.";

type NativeApiFunction =
	| "initialize"
	| "register_logger"
	| "set_log_level"
	| "shutdown"
	| "register_event_callback"
	| "dispatch";

const ALL_LOG_LEVELS: Readonly<LogLevel[]> = [
	"error",
	"warn",
	"info",
	"debug",
	"trace",
];

function isLogLevel(level: string): level is LogLevel {
	return (ALL_LOG_LEVELS as string[]).includes(level);
}

class SMTCNativeBackend {
	private isActive = false;

	private call<T>(func: NativeApiFunction, args: unknown[] = []): T {
		return betterncm_native.native_plugin.call<T>(
			`${NATIVE_API_PREFIX}${func}`,
			args,
		);
	}

	private dispatch<T extends keyof SmtcCommandPayloads>(
		type: T,
		payload: SmtcCommandPayloads[T],
	) {
		const command = JSON.stringify({ type, payload });
		const resultJson = this.call<string>("dispatch", [command]);

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
		this.call("shutdown");

		this.isActive = true;
		this.registerLogger();
		this.call("initialize");

		window.addEventListener("beforeunload", () => {
			if (this.isActive) {
				this.disableDiscordRpc();
				this.disableSmtcSession();
				this.call("shutdown");
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

		this.call("register_event_callback", [eventCallback]);
	}

	public setBackendLogLevel(level: LogLevel) {
		this.call("set_log_level", [level]);
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

				console.log(
					`%c${pluginPart}%c${sourcePart}`,
					badgePluginCss,
					badgeSourceCss,
					entry.message,
				);
			} catch (e) {
				logger.error("解析后端日志失败:", "Native Bridge", e);
			}
		};
		this.call("register_logger", [logCallback]);
	}

	public disable() {
		if (!this.isActive) return;
		this.isActive = false;

		this.call("shutdown");
		logger.info("SMTC 已禁用", "Native Bridge");
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
		this.dispatch("EnableDiscordRpc", undefined);
		logger.info("启用 Discord RPC", "Native Bridge");
	}

	public disableDiscordRpc() {
		if (!this.isActive) return;
		this.dispatch("DisableDiscordRpc", undefined);
		logger.info("禁用 Discord RPC", "Native Bridge");
	}

	public updateDiscordConfig(config: DiscordConfigPayload) {
		if (!this.isActive) return;
		this.dispatch("DiscordConfig", config);
		logger.debug(
			`更新 Discord 配置: showWhenPaused=${config.showWhenPaused}`,
			"Native Bridge",
		);
	}

	public update(songInfo: MetadataPayload) {
		this.dispatch("Metadata", songInfo);
	}

	public updatePlayState(status: PlaybackStatus) {
		this.dispatch("PlayState", { status });
	}

	public updateTimeline(timeline: { currentTime: number; totalTime: number }) {
		this.dispatch("Timeline", timeline);
	}

	public updatePlayMode(playMode: {
		isShuffling: boolean;
		repeatMode: RepeatMode;
	}) {
		this.dispatch("PlayMode", playMode);
	}
}

export const SMTCNativeBackendInstance = new SMTCNativeBackend();
