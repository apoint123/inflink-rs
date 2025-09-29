/**
 * @author richardo2016@gmail.com
 * @email richardo2016@gmail.com
 * @create date 2021-04-29 03:22:44
 * @modify date 2021-04-29 03:22:44
 *
 * @desc native 命名空间 update 相关 api
 */

/**
 * @description 获取 app 内核最新的版本
 */
export async function getAppCoreVersion() {
	return legacyNativeCmder.call<string>("update.getVersion", "core");
}

/**
 * @description 获取 app native package 的版本,
 *
 * 由加载的 native package 资源决定
 */
export async function getNativeVersion() {
	return legacyNativeCmder.call<string | "">("update.getVersion", "native");
}

/**
 * @description 获取 app orpheus package 的版本
 *
 * 由加载的 orpheus package 资源决定
 */
export async function getOrpheusVersion() {
	return legacyNativeCmder.call<string | "">("update.getVersion", "orpheus");
}
