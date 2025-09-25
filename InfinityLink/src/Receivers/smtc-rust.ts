import type { ControlMessage, SmtcEvent } from "src/types/smtc";

// 暂时使用事件轮询来获取后端的更新，因为用rust实现cef的回调机制十分困难
const POLLING_INTERVAL_MS = 100;
const NATIVE_API_PREFIX = "inflink.";

class SMTCNativeBackend {
	private poll_interval_id: NodeJS.Timeout | null = null;

	private call<T>(func: string, args: unknown[] = []): T {
		return betterncm_native.native_plugin.call<T>(
			`${NATIVE_API_PREFIX}${func}`,
			args,
		);
	}

	public apply(
		control_handler: (msg: ControlMessage) => void,
		on_ready: () => void,
	) {
		this.call("initialize");

		this.poll_interval_id = setInterval(() => {
			const events_json = this.call<string | null>("poll_events");
			if (events_json) {
				try {
					const events: SmtcEvent[] = JSON.parse(events_json);
					for (const event of events) {
						if (event.type === "Seek") {
							control_handler({ type: "Seek", position: event.position_ms });
						} else {
							control_handler(event);
						}
					}
				} catch (e) {
					console.error("[InfLink-Native] 解析后端事件失败:", e);
				}
			}
		}, POLLING_INTERVAL_MS);

		on_ready();
	}

	public disable() {
		if (this.poll_interval_id) {
			clearInterval(this.poll_interval_id);
			this.poll_interval_id = null;
		}
		this.call("shutdown");
		console.log("[InfLink-Native] SMTC 已禁用");
	}

	public update(songInfo: {
		songName: string;
		authorName: string;
		albumName: string;
		thumbnail_base64: string;
	}) {
		this.call("update_metadata", [
			songInfo.songName,
			songInfo.authorName,
			songInfo.albumName ?? songInfo.songName,
			songInfo.thumbnail_base64,
		]);
	}

	public updatePlayState(status_code: 3 | 4) {
		this.call("update_play_state", [status_code]);
	}

	public updateTimeline(timeline: { currentTime: number; totalTime: number }) {
		this.call("update_timeline", [timeline.currentTime, timeline.totalTime]);
	}

	public updatePlayMode(playMode: {
		isShuffling: boolean;
		repeatMode: string;
	}) {
		this.call("update_play_mode", [playMode.isShuffling, playMode.repeatMode]);
	}
}

export const SMTCNativeBackendInstance = new SMTCNativeBackend();
