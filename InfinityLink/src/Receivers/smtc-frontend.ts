export const SMTCFrontend = {
    apply(postMsg: (msg: "Pause" | "Play" | "PreviousSong" | "NextSong") => any) {
        navigator.mediaSession.setActionHandler("pause", () => postMsg("Pause"));
        navigator.mediaSession.setActionHandler("play", () => postMsg("Play"));
        navigator.mediaSession.setActionHandler("previoustrack", () =>
            postMsg("PreviousSong"),
        );
        navigator.mediaSession.setActionHandler("nexttrack", () => postMsg("NextSong"));
    },

    disable() {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
        navigator.mediaSession.setPositionState();
    },

    async update({
        songName,
        albumName,
        authorName,
        thumbnail,
    }: {
        songName: string;
        albumName: string;
        authorName: string;
        thumbnail: string;
    }) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: songName,
            album: albumName,
            artist: authorName,
            artwork: [{ src: thumbnail }],
        });
    },

    async updateTimeline({
        currentTime,
        totalTime,
    }: {
        currentTime: number;
        totalTime: number;
    }) {
        navigator.mediaSession.setPositionState({
            duration: totalTime / 1000,
            position: currentTime / 1000,
            playbackRate: 1,
        });
    },

    updatePlayState(state: 3 | 4) {
        navigator.mediaSession.playbackState = state === 3 ? "playing" : "paused";
    },
};
