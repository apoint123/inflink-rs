import { getPlayingSong } from "../hooks";
import { createHookFn, throttle } from "../utils";
import { BaseProvider, PlayState } from "./BaseProvider";

export class NativeProvider extends BaseProvider {
    constructor() {
        super();
        let lastTrackId;

        const checkPlayingSong = () => {
            const playing = getPlayingSong();
            if (lastTrackId !== playing.from.id) {
                lastTrackId = playing.from.id;

                console.log(lastTrackId)
                this.dispatchEvent(
                    new CustomEvent("updateSongInfo", {
                        detail: {
                            songName: playing.data.name,
                            albumName: playing.data.album.name,
                            authorName: playing.data.artists.map(v => v.name).join(" / "),
                            thumbnail: playing.data.album.picUrl,
                        },
                    }),
                );
            }
        }

        this.addEventListener("Pause", () => {
            channel.call("audioplayer.pause", () => { }, ["", ""]);
        });

        this.addEventListener("Play", () => {
            channel.call("audioplayer.play", () => { }, ["", ""]);
        });

        this.addEventListener("PreviousSong", () => {
            (document.querySelector(".btnc-prv") as HTMLButtonElement)?.click();
        });

        this.addEventListener("NextSong", () => {
            (document.querySelector(".btnc-nxt") as HTMLButtonElement)?.click();
        });

        legacyNativeCmder.appendRegisterCall('PlayState', 'audioplayer', (_, __, state) => {
            this.dispatchEvent(
                new CustomEvent("updatePlayState", { detail: state === 1 ? "Playing" : "Paused" }),
            );
        });

        let currentSongLength = 0;

        legacyNativeCmder.appendRegisterCall('Load', 'audioplayer', (_, info) => {
            checkPlayingSong();
            currentSongLength = info.duration;
        });

        legacyNativeCmder.appendRegisterCall(
            "PlayProgress",
            "audioplayer",
            throttle((_, progress) => {
                if (progress === 0 && currentSongLength === 0) return;
                console.debug(`[InfLink] [Native]: ${progress} / ${currentSongLength}`);
                this.dispatchEvent(
                    new CustomEvent("updateTimeline", {
                        detail: {
                            currentTime: progress * 1000,
                            totalTime: currentSongLength * 1000,
                        },
                    }),
                );
            }, 1000)[0],
        );

        const hookedNativeCallFunction = createHookFn(channel.call, [
            (name: string, callback: Function, args: any[]) => {
                if (name !== "player.setInfo") return;
                const { albumName, albumId, artistName, playId, songName, url } = args[0];

                this.dispatchEvent(
                    new CustomEvent("updateSongInfo", {
                        detail: {
                            songName,
                            albumName,
                            authorName: artistName,
                            thumbnail: url,
                        },
                    }),
                );
            },]);

        let songInfoIntervalHandle;
        this.addEventListener("enable", () => {
            channel.call = hookedNativeCallFunction.function;
            if (songInfoIntervalHandle) clearInterval(songInfoIntervalHandle);
            songInfoIntervalHandle = setInterval(checkPlayingSong, 1000);
        });

        this.addEventListener("disable", () => {
            channel.call = hookedNativeCallFunction.origin;
            clearInterval(songInfoIntervalHandle)
        });
    }
}
