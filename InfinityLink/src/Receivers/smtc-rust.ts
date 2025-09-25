/**
 * SMTC Rust Backend Implementation
 * 通过WebSocket与Rust后端通信来控制Windows SMTC
 */

import type {
	CommandData,
	ControlMessage,
	SongInfo,
	TimelineInfo,
} from "src/types/smtc";

export class SMTCRust {
	private ws: WebSocket | null = null;
	private readonly WS_URL = "ws://127.0.0.1:9001";
	private reconnectTimer: number | null = null;
	private isEnabled = false;
	private messageCallback: ((msg: ControlMessage) => void) | null = null;
	private connectionAttempts = 0;
	private readonly MAX_RECONNECT_ATTEMPTS = 10;
	private pendingCommands: CommandData[] = [];
	private onConnectCallback: (() => void) | null = null;
	private backendHasBeenStarted = false;

	constructor() {
		// 不在构造函数中自动连接，等待apply调用
		console.log("[InfLink-Rust] SMTCRust 实例已创建");
	}

	private async startRustBackend(): Promise<void> {
		if (this.backendHasBeenStarted) {
			console.log("[InfLink-Rust] 后端进程已启动过，不再重复启动。");
			return;
		}

		try {
			const backendPath = `${plugin.pluginPath}/backend/smtc_handler.exe`;
			console.log(`[InfLink-Rust] 准备启动后端: ${backendPath}`);

			if (!(await betterncm.fs.exists(backendPath))) {
				console.error(`[InfLink-Rust] 错误: 后端文件不存在于 ${backendPath}`);
				return;
			}

			betterncm.app.exec(backendPath);
			this.backendHasBeenStarted = true;
		} catch (e) {
			console.error("[InfLink-Rust] 启动后端进程时发生错误:", e);
		}
	}

	private handleMessage(event: MessageEvent) {
		try {
			const data = JSON.parse(event.data);

			if (data.event === "ButtonPressed" && this.messageCallback) {
				const msg = { type: data.button as ControlMessage["type"] };
				this.messageCallback(msg as ControlMessage);
			} else if (data.event === "SeekRequested" && this.messageCallback) {
				const msg: ControlMessage = {
					type: "Seek",
					position: data.position_sec * 1000,
				};
				this.messageCallback(msg);
			}
		} catch (e) {
			console.error("[InfLink-Rust] 解析消息失败:", e, "原始数据:", event.data);
		}
	}

	private connect() {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			return;
		}
		if (!this.isEnabled) {
			return;
		}

		// 检查连接尝试次数
		if (this.connectionAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
			console.error("[InfLink-Rust] 已达到最大连接尝试次数。");
			return;
		}

		this.connectionAttempts++;
		console.log(
			`[InfLink-Rust] 尝试连接到 ${this.WS_URL} (${this.connectionAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`,
		);

		try {
			this.ws = new WebSocket(this.WS_URL);

			this.ws.onopen = () => {
				console.log("[InfLink-Rust] 成功连接到 Rust SMTC 后端!");
				this.connectionAttempts = 0;
				if (this.reconnectTimer) {
					clearTimeout(this.reconnectTimer);
					this.reconnectTimer = null;
				}

				this.flushPendingCommands();

				if (this.onConnectCallback) {
					this.onConnectCallback();
				}
			};

			this.ws.onmessage = this.handleMessage.bind(this);

			this.ws.onerror = (error) => {
				console.error("[InfLink-Rust] WebSocket 连接错误:", error);
			};

			this.ws.onclose = (event) => {
				console.log(
					`[InfLink-Rust] 连接已关闭 (代码: ${event.code}, 原因: ${event.reason})`,
				);
				this.ws = null;
				if (
					this.isEnabled &&
					this.connectionAttempts < this.MAX_RECONNECT_ATTEMPTS
				) {
					console.log("[InfLink-Rust] 尝试重新连接...");
					this.scheduleReconnect();
				} else if (this.connectionAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
					console.error("[InfLink-Rust] 已达到最大连接尝试次数。");
				}
			};
		} catch (error) {
			console.error("[InfLink-Rust] 创建 WebSocket 失败:", error);
			if (
				this.isEnabled &&
				this.connectionAttempts < this.MAX_RECONNECT_ATTEMPTS
			) {
				this.scheduleReconnect();
			}
		}
	}

	private flushPendingCommands() {
		console.log(
			`[InfLink-Rust] 发送 ${this.pendingCommands.length} 个待处理的命令...`,
		);
		while (this.pendingCommands.length > 0) {
			const command = this.pendingCommands.shift();
			if (command) {
				this.sendCommand(command, true);
			}
		}
	}

	private scheduleReconnect() {
		if (this.reconnectTimer || !this.isEnabled) return;

		const delay = Math.min(1000 * 2 ** (this.connectionAttempts - 1), 30000);
		console.log(`[InfLink-Rust] 在 ${delay}ms 后连接`);

		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			if (this.isEnabled) {
				console.log("[InfLink-Rust] 正在重连...");
				this.connect();
			}
		}, delay);
	}

	async updatePlayMode(playMode: { isShuffling: boolean; repeatMode: string }) {
		const command: CommandData = {
			command: "UpdatePlayMode",
			data: {
				is_shuffling: playMode.isShuffling,
				repeat_mode: playMode.repeatMode,
			},
		};
		this.sendCommand(command);
	}

	private sendCommand(command: CommandData, force = false) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			try {
				console.log(
					"[InfLink-Rust] 发送命令:",
					JSON.stringify(command, null, 2),
				);
				this.ws.send(JSON.stringify(command));
			} catch (error) {
				console.error("[InfLink-Rust] 发送命令失败:", error);
			}
		} else {
			if (force) {
				console.error(
					"[InfLink-Rust] 强制发送失败，WebSocket 仍然未连接:",
					command,
				);
			} else {
				console.warn(
					"[InfLink-Rust] WebSocket 未连接，命令已加入队列:",
					command,
				);
				this.pendingCommands.push(command);
			}
		}
	}

	apply(postMsg: (msg: ControlMessage) => void, onConnect?: () => void) {
		console.log("[InfLink-Rust] 正在应用后端...");
		this.isEnabled = true;
		this.messageCallback = postMsg;
		this.onConnectCallback = onConnect || null;
		this.connectionAttempts = 0;

		this.startRustBackend();

		setTimeout(() => {
			if (this.isEnabled) {
				console.log("[InfLink-Rust] 尝试连接到后端...");
				this.connect();
			}
		}, 500);
	}

	disable() {
		console.log("[InfLink-Rust] 正在禁用后端...");
		this.isEnabled = false;
		this.messageCallback = null;
		this.onConnectCallback = null;
		this.pendingCommands = [];
		this.connectionAttempts = 0;

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.ws) {
			this.ws.close(1000, "Plugin disabled");
			this.ws = null;
		}

		if (this.backendHasBeenStarted) {
			console.log("[InfLink-Rust] 正在关闭后端进程...");
			try {
				betterncm.app.exec("taskkill /F /IM smtc_handler.exe");
			} catch (e) {
				console.error("[InfLink-Rust] 执行 taskkill 时出错:", e);
			}
			this.backendHasBeenStarted = false;
		}
	}

	async update({
		songName,
		albumName,
		authorName,
		thumbnail_base64,
	}: SongInfo) {
		const command: CommandData = {
			command: "UpdateMetadata",
			data: {
				title: songName,
				artist: authorName,
				album: albumName,
				thumbnail_base64: thumbnail_base64,
			},
		};

		this.sendCommand(command);
	}

	async updateTimeline({ currentTime, totalTime }: TimelineInfo) {
		const command: CommandData = {
			command: "UpdateTimeline",
			data: {
				current: currentTime,
				total: totalTime,
			},
		};
		this.sendCommand(command);
	}

	updatePlayState(state: 3 | 4) {
		const command: CommandData = {
			command: "UpdateStatus",
			data: state,
		};
		this.sendCommand(command);
	}
}

export const SMTCRustBackend = new SMTCRust();
