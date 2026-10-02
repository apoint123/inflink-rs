import type { PlaybackStatus, RepeatMode, SongInfo } from "@/types/api";
import type {
	AppMessage,
	CommandResult,
	ControlMessage,
	DiscordConfigPayload,
	LogEntry,
	MetadataCoverPayload,
	MetadataPayload,
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
	dispatchWithArrayBuffer: (
		args: [
			commandJson: string,
			size: number,
			callback: (buffer: ArrayBuffer) => void,
		],
	) => string;
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
	private updateGeneration = 0;

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
		this.handleCommandResult(
			type as string,
			this.call("dispatch", [JSON.stringify({ type, payload })]),
		);
	}

	/**
	 * 处理后端对一条命令的返回结果（`dispatch` 与 `dispatchWithArrayBuffer` 共用）
	 *
	 * 返回解析出的结果；解析不出来时返回 `undefined`。
	 */
	private handleCommandResult(
		type: string,
		resultJson: string,
	): CommandResult | undefined {
		if (!resultJson) {
			logger.error(`命令 '${type}' 未收到任何返回结果。`, "Native Bridge");
			return undefined;
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
			return result;
		} catch (e) {
			logger.error(
				`解析后端返回结果失败:`,
				"Native Bridge",
				e,
				"\n原始结果:",
				resultJson,
			);
			return undefined;
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

	public async update(songInfo: SongInfo): Promise<void> {
		this.updateGeneration++;
		const generation = this.updateGeneration;

		let coverBytes: Uint8Array | undefined;

		if (songInfo.cover?.blob) {
			try {
				coverBytes = new Uint8Array(await songInfo.cover.blob.arrayBuffer());

				// 等待期间可能有更新的更新插了进来, 这时候这次更新已经没有意义了
				if (generation !== this.updateGeneration) return;
			} catch (e) {
				logger.warn(
					`读取封面二进制数据失败: ${(e as Error).message}`,
					"Native Bridge",
				);
			}
		}

		this.dispatchMetadata(songInfo, coverBytes);
	}

	/**
	 * 发送元数据更新
	 *
	 * 拿到封面字节时走 `dispatchWithArrayBuffer`：一次调用里同时交二进制和命令，
	 * 后端读回字节后直接把它挂到这条命令上，二者不可能错配。
	 * 没有字节（或读取失败）时退回普通 `dispatch`，封面交给后端按 URL 取。
	 */
	private dispatchMetadata(
		songInfo: SongInfo,
		coverBytes: Uint8Array | undefined,
	) {
		const payload = this.toMetadataPayload(songInfo, {
			url: songInfo.cover?.url,
		});

		if (!coverBytes || coverBytes.byteLength === 0) {
			this.dispatch("UpdateMetadata", payload);
			return;
		}

		// 与前一条 `dispatch` 完全相同的载荷，只是额外捎带一次二进制传输
		const command = JSON.stringify({ type: "UpdateMetadata", payload });
		const result = this.handleCommandResult(
			"UpdateMetadata",
			this.call("dispatchWithArrayBuffer", [
				command,
				coverBytes.byteLength,
				(target: ArrayBuffer) => {
					new Uint8Array(target).set(coverBytes);
				},
			]),
		);

		if (result?.status === "Success") {
			logger.debug(
				`封面二进制数据已随命令送达后端 (${coverBytes.byteLength} 字节)`,
				"Native Bridge",
			);
		}
	}

	private toMetadataPayload(
		songInfo: SongInfo,
		cover: MetadataCoverPayload | undefined,
	): MetadataPayload {
		return {
			songName: songInfo.songName,
			albumName: songInfo.albumName,
			authorName: songInfo.authorName,
			cover: cover?.url ? cover : null,
			ncmId: songInfo.ncmId,
			duration: songInfo.duration,
		};
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
