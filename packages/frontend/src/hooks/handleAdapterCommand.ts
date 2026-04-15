import type { INcmAdapter } from "../adapters/adapter";
import type { ControlMessage } from "../types/backend";
import logger from "../utils/logger";

export function handleAdapterCommand(
	adapter: INcmAdapter,
	msg: ControlMessage,
) {
	switch (msg.type) {
		case "Play":
			adapter.play();
			break;
		case "Pause":
			adapter.pause();
			break;
		case "Stop":
			adapter.stop();
			break;
		case "NextSong":
			adapter.nextSong();
			break;
		case "PreviousSong":
			adapter.previousSong();
			break;
		case "Seek":
			adapter.seekTo(msg.position_ms);
			break;
		case "ToggleShuffle":
			adapter.toggleShuffle();
			break;
		case "ToggleRepeat":
			adapter.toggleRepeat();
			break;
		case "SetRepeat":
			adapter.setRepeatMode(msg.mode);
			break;
		case "SetVolume":
			adapter.setVolume(msg.level);
			break;
		case "ToggleMute":
			adapter.toggleMute();
			break;
		default: {
			const exhaustedCheck: never = msg;
			logger.warn(`未处理的命令:`, "handleAdapterCommand", exhaustedCheck);
			break;
		}
	}
}
