export const SMTC = {
    apply(postMsg) {
        betterncm_native.native_plugin.call("inflink.enableSMTC", []);
        betterncm_native.native_plugin.call(
            "inflink.registerSMTCEventCallback",
            [
                (btn) => {
                    const MESSAGE_MAP = {
                        6: "NextSong",
                        7: "PreviousSong",
                        1: "Pause",
                        0: "Play",
                    };
                    if (MESSAGE_MAP[btn] !== undefined)
                        postMsg(MESSAGE_MAP[btn])
                    else
                        console.warn(
                            "[InfLink] Unknown SMTC button id",
                            btn,
                        );
                },
            ],
        );
    },
    disable() {
        betterncm_native.native_plugin.call("inflink.disableSMTC", []);
    },
    async update({ songName, albumName, authorName, thumbnail }) {
        await betterncm.fs.mkdir('./InfLink-Thumbnail-Cache/')
        for (const file of await betterncm.fs.readDir('./InfLink-Thumbnail-Cache/')) {
            const time = parseInt(file.split('-')[3].split('.')[0]);
            if (Date.now() - time > 1000 * 60 * 60) {
                await betterncm.fs.remove(file);
            }
        }

        const filePath = `/InfLink-Thumbnail-Cache/thumbnail-${Date.now()}.${thumbnail.split(".").pop()}`;
        await betterncm.fs.writeFile(filePath,
            await (await fetch(thumbnail)).blob());

        betterncm_native.native_plugin.call("inflink.updateSMTC", [
            songName,
            albumName,
            authorName,
            `${await betterncm.app.getDataPath()}${filePath}`,
            thumbnail
        ]);
    },
    async updateTimeline({ currentTime, totalTime }) {
        betterncm_native.native_plugin.call("inflink.updateSMTCTimeline", [
            currentTime,
            totalTime
        ]);
    },
    updatePlayState(state) {
        betterncm_native.native_plugin.call(
            "inflink.updateSMTCPlayState",
            [state],
        );
    }
}