import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { DiscordDisplayMode } from "./types/backend";
import type { LogLevel } from "./utils/logger";

const STORE_KEY_BASE = "inflink-rs";
const STORE_KEY_SMTC_ENABLED = `${STORE_KEY_BASE}.smtc-enabled`;
const STORE_KEY_FRONTEND_LOG_LEVEL = `${STORE_KEY_BASE}.frontendLogLevel`;
const STORE_KEY_BACKEND_LOG_LEVEL = `${STORE_KEY_BASE}.backendLogLevel`;
const STORE_KEY_RESOLUTION = `${STORE_KEY_BASE}.resolution_setting`;
const STORE_KEY_INTERNAL_LOGGING_ENABLED = `${STORE_KEY_BASE}.internal_logging_enabled`;
const STORE_KEY_DISCORD_ENABLED = `${STORE_KEY_BASE}.discord_enabled`;
const STORE_KEY_DISCORD_SHOW_PAUSED = `${STORE_KEY_BASE}.discord_show_paused`;
const STORE_KEY_DISCORD_DISPLAY_MODE = `${STORE_KEY_BASE}.discord_display_mode`;

export const smtcEnabledAtom = atomWithStorage<boolean>(
	STORE_KEY_SMTC_ENABLED,
	true,
);

export const discordEnabledAtom = atomWithStorage<boolean>(
	STORE_KEY_DISCORD_ENABLED,
	false,
);

export const discordShowPausedAtom = atomWithStorage<boolean>(
	STORE_KEY_DISCORD_SHOW_PAUSED,
	false,
);

export const discordDisplayModeAtom = atomWithStorage<DiscordDisplayMode>(
	STORE_KEY_DISCORD_DISPLAY_MODE,
	"Name",
);

export const resolutionAtom = atomWithStorage<string>(
	STORE_KEY_RESOLUTION,
	"500",
);

export const frontendLogLevelAtom = atomWithStorage<LogLevel>(
	STORE_KEY_FRONTEND_LOG_LEVEL,
	"warn",
);

export const backendLogLevelAtom = atomWithStorage<LogLevel>(
	STORE_KEY_BACKEND_LOG_LEVEL,
	"warn",
);

export const internalLoggingAtom = atomWithStorage<boolean>(
	STORE_KEY_INTERNAL_LOGGING_ENABLED,
	false,
);

export const appConfigAtom = atom((get) => ({
	smtcEnabled: get(smtcEnabledAtom),
	discordEnabled: get(discordEnabledAtom),
	discordShowPaused: get(discordShowPausedAtom),
	discordDisplayMode: get(discordDisplayModeAtom),
}));
