export const DCRPC = {
    async apply() {
        if (!await betterncm.fs.exists("./InfLink-Discord-RPC")) {
            const pluginBase = (loadedPlugins as any).InfLink.pluginPath.split("/./").pop();
            await betterncm.fs.mkdir("./InfLink-Discord-RPC");
            await betterncm.fs.writeFileText("./InfLink-Discord-RPC/start_easyrp.bat",
                await betterncm.fs.readFileText(pluginBase + "/start_easyrp.bat")
            );

            await betterncm.fs.writeFile("./InfLink-Discord-RPC/easyrp.exe",
                await fetch(BETTERNCM_FILES_PATH + "/" + pluginBase + "/easyrp.exe").then(v => v.blob())
            );
        }
        betterncm.app.exec(`cmd /c cd /d "${betterncm_native.app.datapath()}\\InfLink-Discord-RPC" & start /B start_easyrp.bat`);
    },
    genConfigINI(name, artist, cover) {
        return `
[Identifiers]
ClientID=1101918033640951941

[State]
State=${artist}
Details=${name}
StartTimestamp=${Date.now()}

[Images]
LargeImage=${cover}
LargeImageTooltip=${name}
SmallImage=bncm
SmallImageTooltip=BetterNCM
`
    },
    async update({ songName, authorName, thumbnail }) {
        await betterncm.fs.writeFileText("./InfLink-Discord-RPC/config.ini",
            this.genConfigINI(songName, authorName, thumbnail)
        )
    },
}