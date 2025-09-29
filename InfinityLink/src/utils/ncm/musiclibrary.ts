/**
 * @author chenlei06
 * @email chenlei06@corp.netease.com
 * @create date 2021-05-02 19:21:46
 * @modify date 2021-05-02 19:21:46
 *
 * @desc native 命名空间 musiclibrary 相关 api
 */

/**
 * @description 获取一个 <length> 长的随机字符
 * @param length
 * @returns
 */
function randString(length: number = 10) {
	const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
	let result = "";
	for (let i = 0, rnum: number; i < length; ++i) {
		rnum = Math.floor(Math.random() * chars.length);
		result += chars.charAt(rnum);
	}
	return result;
}

/**
 * @description 对于音乐库对应的 sqlite, 执行 sqlString
 *
 * 在 win32 上, 这个执行是事务性的, 所以:
 * 1. 可以不必担心读写的问题;
 * 2. 但可能会比较慢
 *
 */
export async function execSql<TResultTuple extends unknown[] = unknown[]>(
	sqlString: string | string[],
	{
		task_id = randString(),
	}: {
		task_id?: string;
	} = {},
) {
	const p = legacyNativeCmder
		.createPromiseFromOrpheusEvent<
			[
				{
					/** @description 和 task_id 一致 */
					id: string;
					/** @description true 表示执行成功  */
					result: boolean;
					/** @description 错误码, 当 result 为 true 时为 0, 否则为非 0 整数 */
					error: number;
					/** @description 错误原因, 当 result 为 true 是为 '' */
					reason: string;
					/** @description 按和 sqlStrings 顺序相同顺序匹配的执行返回结果 */
					value: TResultTuple;
				},
			]
		>("musiclibrary.onexecsql", {
			filter_result: (_ctx, results) => results[0].id === task_id,
		})
		.then((res) => res[0]);

	const sqlStrings = arraify(sqlString);

	/**
	 * @description 根据实现, 在 win32, 执行完该命令会通过 callback 返回一个 boolean retValue, 用来指明
	 * "是否由用户提交的 sqlStrings 创建了 sql 的执行任务".
	 *
	 * 一般来说并不会失败, 除非 sqlStrings 混入了非字符型的的元素.
	 */
	const ret = await legacyNativeCmder.call<boolean>(
		"musiclibrary.execSql",
		task_id,
		sqlStrings,
	);

	if (!ret) {
		throw new Error(
			`[musiclibrary.execSql] create sql execution task failed! check input sqlStrings: \n${sqlStrings}`,
		);
	}

	return p;
}

type IGetLibraryPathKey = "<download>" | "<mymusic>";
/**
 * @description 根据 key 获取各种库的路径
 *
 * '<download>': 下载目录
 * '<mymusic>': "音乐" 目录, 在 windows 上, > server 2003 的的版本才有意义
 */
export async function getLibraryPath<TK extends IGetLibraryPathKey>(
	keys: TK[],
) {
	return legacyNativeCmder.call<
		{
			id: TK;
			path: string;
		}[]
	>("musiclibrary.getLibraryPath", keys);
}

function arraify<T>(itemOrList: T | T[]): T[] {
	return Array.isArray(itemOrList) ? itemOrList : [itemOrList];
}
