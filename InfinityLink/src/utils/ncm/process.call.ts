/**
 * @author chenlei06
 * @email chenlei06@corp.netease.com
 * @create date 2021-05-02 22:47:53
 * @modify date 2021-05-02 22:47:53
 *
 * @desc native 的 process.call api
 */

/**
 * process.call 是一个特殊的命令, 似乎它只能调用一些非常特定的子命令
 *
 * legacyNativeCmder.call(
 *  cmd: 'process.call',
 *  id: Integer,
 *  module: 'cloudmusic_util',
 *  params: 'upload.stop',
 *  filename: string
 * )
 *
 * legacyNativeCmder.call(
 *  cmd: 'process.call',
 *  id: Integer,
 *  module: 'cloudmusic_util',
 *  params: 'upload.upload',
 *  jsonstring: string
 * )
 *
 * 当这样的调用发生时, 会有 'subprocess.oncall' 事件抛出:
 *
 * legacyNativeCmder.registerCall(''subprocess.oncall', (taskId: string, funcname: 'upload.upload' | 'upload.stop', retjson: string) => {
 * })
 */

type IProxyInformation = {
	/** @description 网络代理类型 */
	proxytype: unknown;
	/** @description 网络代理 host */
	host: string;
	/** @description 网络代理 port */
	port: string;
	/** @description 网络代理 username */
	username: string;
	/** @description 网络代理 密码 */
	password: string;
	/** @description 网络代理 加密参数 */
	encryptParam: string;
};

type IUploadData = {
	/** @description 是否采用加密传输 */
	encrypt: 1 | 0;
	/** @description 音频 md5 检测 url */
	audioMd5CheckUrl: string;
	/** @description 音频 md5 检测 uri */
	audioMd5CheckUri: string;
	/** @description 上传状态检测 url */
	uploadCheckUrl: string;
	/** @description 上传 url */
	uploadUrl: string;
	/** @description 上传元信息 url */
	uploadMetaUrl: string;
	/** @description 上传元信息 uris */
	uploadMetaUri: string;
	/** @description 上传域名 */
	domain: string;
	/** @description 音频文件标题 */
	title: string;
	/** @description 音频文件专辑名 */
	album: string;
	/** @description 音频文件艺术家名 */
	artist: string;
	/** @description 交互用 http cookie */
	cookie: string;
	/** @description 待上传的文件路径 */
	path: string;
	/** @description 音频文件 bitrate */
	bitrate: string;
	/** @description 在曲库中的 id */
	songId: string;
	/** @description track 类型, cueFile 为 100, 否则为 0 */
	tracktype: 100 | 0;
	/** @description 歌曲开始时间 */
	starttime: string;
	/** @description 歌曲持续时间 */
	duration: string;
} & IProxyInformation &
	Partial<IUploadPauseData>;

type IUploadPauseData = {
	/** @description 上传目标 bucket */
	bucket: string;
	/** @description 上传用 token */
	token: string;
	/** @description 存储对象 key */
	objectKey: string;
	/** @description 存储文档 id */
	docId: string;
	/** @description 上传上下文 */
	context: string;
};

/**
 * @description 开始长传文件
 */
export async function cloudmusicUtilUploadUpload(input: IUploadData) {
	legacyNativeCmder.call(
		"process.call",
		1,
		"cloudmusic_util",
		"upload.upload",
		JSON.stringify(input),
	);
}

/**
 * @description 停止上传某个文件
 */
export async function cloudmusicUtilUploadStop(file: unknown) {
	legacyNativeCmder.call(
		"process.call",
		1,
		"cloudmusic_util",
		"upload.stop",
		file,
	);
}
