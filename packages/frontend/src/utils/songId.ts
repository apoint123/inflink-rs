import type { SongInfo } from "@/types/api";

/**
 * 判断两个歌曲信息是否指向同一首歌。
 *
 * 优先比较内部唯一 trackId；若双方 ncmId 均为有效云端 ID (> 0) 则对比 ncmId；
 * 若为未匹配的本地歌曲（ncmId 为 0 且无 trackId），则对比关键元数据。
 */
export function isSameSong(
	a: SongInfo | null | undefined,
	b: SongInfo | null | undefined,
): boolean {
	if (!a || !b) return a === b;
	if (a.trackId && b.trackId) {
		return a.trackId.toLowerCase() === b.trackId.toLowerCase();
	}
	if (a.ncmId > 0 && b.ncmId > 0) {
		return a.ncmId === b.ncmId;
	}
	return (
		a.songName === b.songName &&
		a.authorName === b.authorName &&
		a.albumName === b.albumName &&
		a.duration === b.duration
	);
}
