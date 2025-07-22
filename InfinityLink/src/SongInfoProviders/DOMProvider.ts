import { reactInstance } from "../utils";
import { BaseProvider, PlayState } from "./BaseProvider";


export class DOMProvider extends BaseProvider {
    constructor() {
        super();
        let lastImgUrl;

        this.addEventListener("Pause", () => {
            (document.querySelector(".btnp, .cmd-icon-pause") as HTMLButtonElement)?.click();
        });

        this.addEventListener("Play", () => {
            (document.querySelector(".btnp, .cmd-icon-play") as HTMLButtonElement)?.click();
        });

        this.addEventListener("PreviousSong", () => {
            (document.querySelector(".btnc-prv, .cmd-icon-pre") as HTMLButtonElement)?.click();
        });

        this.addEventListener("NextSong", () => {
            (document.querySelector(".btnc-nxt, .cmd-icon-next") as HTMLButtonElement)?.click();
        });

        let playState: PlayState;
        setInterval(() => {
            const state = document.querySelector(".btnp-pause, .cmd-icon-pause")
                ? "Playing"
                : "Paused";
            if (playState !== state) {
                playState = state;
                this.dispatchEvent(
                    new CustomEvent("updatePlayState", { detail: playState }),
                );
            }
        }, 50);

        setInterval(() => {
            if (document.querySelector(".j-cover, [class^=\"DefaultBarWrapper_\"]")) {
                let imgUrl = (
                    document?.querySelector(".j-cover") as HTMLImageElement
                )?.src
                    .replace("orpheus://cache/?", "")
                    .replace(/\?(.*)/, "");

                imgUrl ??= reactInstance(document.querySelector('[class^="DefaultBarWrapper_"]')!).child.memoizedState.memoizedState[0][2].data.resource.album.cover

                if (lastImgUrl === imgUrl) return;
                lastImgUrl = imgUrl;
                console.log("UPDATE");
                const songName = (
                    document.querySelector(
                        ".j-title",
                    ) as HTMLParagraphElement | null
                )?.title ?? (
                    document.querySelector(
                        ".cmd-space.title > span",
                    ) as HTMLParagraphElement | null
                )?.innerText;
                this.dispatchEvent(
                    new CustomEvent("updateSongInfo", {
                        detail: {
                            songName,
                            albumName: songName,
                            authorName: (
                                document.querySelector(
                                    "p.j-title span.f-dib, .cmd-space.title .author",
                                ) as HTMLParagraphElement
                            ).innerText,
                            thumbnail: imgUrl,
                        },
                    }),
                );
            }
        }, 100);

        function elemVisible(e: HTMLElement): boolean {
            const style = window.getComputedStyle(e)
            return style.display !== 'none' && style.visibility !== 'hidden'
        }

        const updateTimeline = () => {
            let currentTime: string | undefined;
            let totalTime: string | undefined;

            const timeToMillis = (timeText: string) => {
                const [minutes, seconds] = timeText.split(":").map(Number);
                return (minutes * 60 + seconds) * 1000;
            };

            const ncm3CurrentTimeEl = document.querySelector<HTMLParagraphElement>(
                ".cmd-space.middle  > div:nth-child(2) > p:nth-child(1)",
            );
            const ncm3CurrentTime = ncm3CurrentTimeEl?.innerText || "00:00";
            const ncm3TotalTimeEl = document.querySelector<HTMLParagraphElement>(
                ".cmd-space.middle  > div:nth-child(2) > p:nth-child(3)",
            );
            const ncm3TotalTime = ncm3TotalTimeEl?.innerText || "00:00";
            if (ncm3CurrentTime !== "00:00" || ncm3TotalTime !== "00:00") {
                currentTime = ncm3CurrentTime;
                totalTime = ncm3TotalTime;
            } else {
                // 啥都没有可能在内页
                const timeText = document.querySelector<HTMLParagraphElement>(
                    ".cmd-space > div:nth-child(2) > p:nth-child(1)",
                )?.innerText;
                if (timeText) {
                    [currentTime, totalTime] = timeText.split(" / ");
                }
            }

            if (!currentTime || !totalTime) {
                // ncm2
                let currentPlayerElem: HTMLDivElement | undefined;
                const playerElems =
                    document.querySelectorAll<HTMLDivElement>(".m-player");
                for (let i = 0; i < playerElems.length; i++) {
                    const playerElem = playerElems[i];
                    if (elemVisible(playerElem)) {
                        currentPlayerElem = playerElem;
                        break;
                    }
                }
                if (!currentPlayerElem) {
                    console.debug(`[InfLink] No player found`);
                    return;
                }

                const mainPlayerTimeNowEl =
                    currentPlayerElem.querySelector<HTMLTimeElement>("time.now")!;
                const timeAllEl =
                    currentPlayerElem.querySelector<HTMLTimeElement>("time.all")!;
                currentTime = mainPlayerTimeNowEl.innerText;
                totalTime = timeAllEl.innerText;
            }

            const currentTimeMillis = timeToMillis(currentTime);
            const totalTimeMillis = timeToMillis(totalTime);
            console.debug(`[InfLink] Time: ${currentTimeMillis} / ${totalTimeMillis}`);
            if (currentTimeMillis === 0 && totalTimeMillis === 0) return;
            this.dispatchEvent(
                new CustomEvent("updateTimeline", {
                    detail: {
                        currentTime: currentTimeMillis,
                        totalTime: totalTimeMillis,
                    },
                }),
            );
        };

        setInterval(updateTimeline, 2000);

        document.addEventListener('click', (event) => {
            // 监听主页的进度条、内页的进度条、歌词旁边的一键跳转
            if (event.target instanceof HTMLElement && 
                (event.target.closest('.cmd-space > div > .slider-default') || 
                 event.target.closest('.cmd-space > div > .slider-vinyl') || 
                 event.target.closest('div[class^="ScrollableLyricDisplayContainer"]'))) {
                updateTimeline();
            }
        });
    }
}
