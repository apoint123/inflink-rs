import type { ControlMessage, SmtcEvent } from "src/types/smtc";

const NATIVE_API_PREFIX = "inflink.";

class SMTCNativeBackend {
	private is_active = false;

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
		if (this.is_active) return;
		this.is_active = true;
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

	public disable() {
		if (!this.is_active) return;
		this.is_active = false;

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
