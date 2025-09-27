import type {
	CommandResult,
	ControlMessage,
	LogEntry,
	PlaybackStatus,
	SmtcCommandPayloads,
	SmtcEvent,
} from "../types/smtc";

const NATIVE_API_PREFIX = "inflink.";

class SMTCNativeBackend {
	private isActive = false;

	private call<T>(func: string, args: unknown[] = []): T {
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
			console.error(`[InfLink-Native] 命令 '${type}' 未收到任何返回结果。`);
			return;
		}

		try {
			const result: CommandResult = JSON.parse(resultJson);
			if (result.status === "Error") {
				console.error(
					`[InfLink-Native] 后端执行命令 '${type}' 时发生错误:`,
					result.message,
				);
			}
		} catch (e) {
			console.error(
				`[InfLink-Native] 解析后端返回结果失败:`,
				e,
				"\n原始结果:",
				resultJson,
			);
		}
	}

	public initialize(
		control_handler: (msg: ControlMessage) => void,
		on_ready: () => void,
	) {
		// betterncm 热重载时会直接销毁整个JS环境，并且不会运行我们的清理函数，
		// 这会导致后端因为悬垂指针崩溃，所以必须每次运行之前都清理一次
		this.call("cleanup");

		if (this.isActive) return;
		this.isActive = true;
		this.registerLogger();
		this.call("initialize");

		const eventCallback = (eventJson: string) => {
			try {
				const event: SmtcEvent = JSON.parse(eventJson);
				if (event.type === "Seek") {
					control_handler({
						type: "Seek",
						position: event.position_ms,
					});
				} else {
					control_handler(event);
				}
			} catch (e) {
				console.error("[InfLink-Native] 解析后端事件失败:", e);
			}
		};

		this.call("register_event_callback", [eventCallback]);

		on_ready();
	}

	private registerLogger() {
		const logCallback = (logJson: string) => {
			try {
				const entry: LogEntry = JSON.parse(logJson);
				const message = `[InfLink-rs backend|${entry.target}] ${entry.message}`;

				switch (entry.level) {
					case "ERROR":
						console.error(message);
						break;
					case "WARN":
						console.warn(message);
						break;
					case "INFO":
						console.info(message);
						break;
					default:
						console.log(message);
						break;
				}
			} catch (e) {
				console.error("[InfLink-Native] 解析后端日志失败:", e);
			}
		};
		this.call("register_logger", [logCallback]);
	}

	public disable() {
		if (!this.isActive) return;
		this.isActive = false;

		this.call("cleanup");
		this.call("shutdown");
		console.log("[InfLink-Native] SMTC 已禁用");
	}

	public update(songInfo: {
		songName: string;
		authorName: string;
		albumName: string;
		thumbnail_base64: string;
	}) {
		this.dispatch("Metadata", {
			...songInfo,
			albumName: songInfo.albumName ?? songInfo.songName,
		});
	}

	public updatePlayState(status: PlaybackStatus) {
		this.dispatch("PlayState", { status });
	}

	public updateTimeline(timeline: { currentTime: number; totalTime: number }) {
		this.dispatch("Timeline", timeline);
	}

	public updatePlayMode(playMode: {
		isShuffling: boolean;
		repeatMode: string;
	}) {
		this.dispatch("PlayMode", playMode);
	}
}

export const SMTCNativeBackendInstance = new SMTCNativeBackend();
