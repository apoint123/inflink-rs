/**
 * @author chenlei06
 * @email chenlei06@corp.netease.com
 * @create date 2021-05-01 21:59:11
 * @modify date 2021-05-01 21:59:11
 *
 * @desc native 命名空间 app 相关 api
 */

/**
 * @description 退出 app, 会关闭所有打开的窗口, 并退出进程
 */
export async function exit() {
	legacyNativeCmder.call("app.exit");
}

/**
 * @description 获取 app 的启动方式
 *
 * 该方法在 mac 上意义不大, 因为它总是返回 'autorun'
 */
export async function getAppStartType() {
	return legacyNativeCmder.call<"" | "autorun" | "updaterun">(
		"app.getAppStartType",
	);
}

type ProxyConfigWithHost = {
	/** @description 代理类型 */
	type: unknown;
	/** @description 代理服务器地址, 包括端口号 */
	proxy_host: `${string}:${string}`;
	/** @description 代理服务器 username */
	user?: string;
	/** @description 代理服务器 密码 */
	password?: string;
};

type ProxyConfigDisabled = {
	/** @description 当传了非 IProxyType 值时表示不用经过代理服务器 */
	type?: null | "";
};

type ProxyTestOptions = (ProxyConfigWithHost | ProxyConfigDisabled) & {
	/** @description 测试代理是否可用的目标地址 */
	test_url?: string;
};

const DEFAULT_PROXT_TEST_URL = "http://music.163.com";

export async function testProxy(conf?: ProxyTestOptions) {
	const task_id = 0;

	const p = legacyNativeCmder
		.createPromiseFromOrpheusEvent<[task_id: number, err_code: unknown]>(
			"app.ontestproxy",
			{
				/** win32 上, app.testProxy 的超时时间是 30s */
				timeout: 35000,
				filter_result: (_ctx, results) => results[0] === task_id,
			},
		)
		.catch(() => [0, false]);

	const test_url = conf?.test_url ?? DEFAULT_PROXT_TEST_URL;

	if (conf?.type) {
		const {
			type,
			proxy_host,
			user = "",
			password = "",
		} = conf as ProxyConfigWithHost;

		legacyNativeCmder.call<void>(
			"app.testProxy",
			task_id,
			type,
			proxy_host,
			user,
			password,
			test_url,
		);
	} else {
		legacyNativeCmder.call<void>(
			"app.testProxy",
			task_id,
			"",
			"",
			"",
			"",
			test_url,
		);
	}

	return p.then((res) => res[1] === 0);
}
