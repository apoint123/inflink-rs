/**
 * 判断两个歌曲 id 是否指向同一首歌。
 *
 * `SongInfo.ncmId` 是 `number`，但适配器去重状态、镜像等处可能以 `string | null` 形式持有
 */
export function isSameSongId(
	a: string | number | null | undefined,
	b: string | number | null | undefined,
): boolean {
	return String(a) === String(b);
}
