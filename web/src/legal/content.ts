import type { Locale } from '../i18n';

/**
 * 合规文案（三层提示的文本层）。
 *
 * 这里只放**纯数据**：顶部 Banner、首次确认弹窗、完整条款三段文案，中/英/日各一份。
 * 文案必须与实现保持一致，两件事必须同时说清：
 * ① 通道仍是纯内存（无数据库、默认 30 分钟无上传过期、重启即丢）；
 * ② 但服务端会把**文本原文 + 上传者 IP + 接收者 IP + User-Agent** 落盘为审计日志，
 *   保留 8 个月（243 天）。绝不能声称「服务端不留存文本」—— 那与实现矛盾，属虚假陈述。
 *
 * 事实依据（改服务端行为时请同步改本文件）：
 * - 通道：无数据库、默认 30 分钟无上传过期、TTL 可配 60–86400 秒：
 *   server/src/config.ts、server/src/services/channelStore.ts
 * - 磁盘审计日志（AUDIT_LOG_* 契约，字段名三方共享，不得重命名）：
 *   env AUDIT_LOG_ENABLED（默认 true）、AUDIT_LOG_DIR（默认 logs）、
 *   AUDIT_LOG_RETENTION_DAYS（默认 243，范围 1–3650）；
 *   文件 <AUDIT_LOG_DIR>/transfer-YYYY-MM-DD.jsonl（UTC 日期、一行一 JSON、0700/0600）；
 *   upload 记录 text 原文、uploaderIp、uploaderUa、recipients[{ip,ua}]；
 *   viewer_connect / viewer_disconnect 记录 ip、ua、durationMs；
 *   启动与跨天滚动时删除早于「今天 - RETENTION_DAYS」的文件。
 * - 运行日志（方法 / 路径 / 状态码 / 耗时 / 客户端 IP / User-Agent）与业务事件：
 *   server/src/middleware/accessLog.ts、server/src/logger.ts
 * - 浏览器存储键：web/src/stores/preferences.ts、web/src/composables/useLegal.ts
 * - 仓库与协议：https://github.com/Dynesshely/Live-QR （AGPL-3.0）
 *
 * 注意：文案里「不使用 Cookie / 不接入第三方统计」基于当前 index.html 无任何第三方脚本；
 * 若将来接入统计或广告，必须先改这里。审计日志的字段以后端实现为准，别凭印象写。
 */

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalBannerCopy {
  title: string;
  body: string[];
  /** 关闭按钮的 aria-label / title */
  dismissLabel: string;
}

export interface LegalConsentCopy {
  title: string;
  /** 要点段落 */
  body: string[];
  /** 简短要点列表 */
  bullets: string[];
  agreeLabel: string;
  laterLabel: string;
}

export interface LegalTermsCopy {
  title: string;
  /** 直接可显示的更新日期，如「更新日期：2026-10-30」 */
  updatedAt: string;
  acknowledgeLabel: string;
  /** 右上角关闭按钮的 aria-label */
  closeLabel: string;
  sections: LegalSection[];
}

export interface LegalCopy {
  banner: LegalBannerCopy;
  consent: LegalConsentCopy;
  terms: LegalTermsCopy;
  /** 三处共用的链接文案 */
  links: { viewTerms: string };
}

/** 条款更新日期（YYYY-MM-DD），三语文案里的 updatedAt 必须与之一致 */
export const LEGAL_UPDATED_AT = '2026-10-30';

const zh: LegalCopy = {
  banner: {
    title: '技术演示 · 请勿用于非法用途',
    body: [
      '技术演示：通道内容约 30 分钟无上传即过期，但为安全审计，转发的文本原文以及上传者与接收者的 IP 会另存到磁盘并保留 8 个月（243 天）。',
      '请勿上传任何你不愿被保存的内容（含密码、验证码、证件号码等）；持有 8 位分享码的任何人都能看到该文本。',
    ],
    dismissLabel: '本次会话内关闭提示',
  },
  links: { viewTerms: '查看完整条款' },
  consent: {
    title: '使用前请阅读',
    body: [
      '本站是一个开源的实时二维码投递技术演示，不是通讯服务，也不向用户提供存储或备份服务，不保证可用性。',
      '继续使用即表示你已阅读并同意下列要点与完整条款。',
    ],
    bullets: [
      '通道内容在服务器内存中约保留 30 分钟（默认无上传自动过期，重启即丢）；但审计日志会把转发文本原文与上传者、接收者的 IP 另存到磁盘保留 8 个月（243 天）。',
      '持有 8 位分享码的任何人都能看到你上传的文本；请勿上传密码、验证码、证件号码、银行卡号等敏感信息。',
      '禁止上传或传播任何违法违规内容，禁止将本站用于非法用途；违规通道可被随时终止。',
      '服务端会把每次上传的文本原文、上传者 IP、接收者（观看者）IP 与 User-Agent 写入磁盘审计日志，保留 8 个月（243 天）后自动删除，仅用于安全审计、限流取证与依法配合主管部门。',
      '因此请勿上传任何你不愿被保存的内容（包括密码、验证码、证件号码、银行卡号等）。',
    ],
    agreeLabel: '我已阅读并同意',
    laterLabel: '稍后再说',
  },
  terms: {
    title: '服务条款与隐私说明',
    updatedAt: '更新日期：2026-10-30',
    acknowledgeLabel: '我已阅读',
    closeLabel: '关闭条款',
    sections: [
      {
        heading: '一、服务性质',
        paragraphs: [
          'Live QR 是一个开源的实时二维码投递技术演示：上传端用浏览器摄像头扫描二维码，把解码出的文本发送到服务器；观看端输入 8 位分享码，即可实时看到该文本并重新渲染为二维码。上传端与观看端是同一个网页应用的两种模式，没有原生 App，也没有数据库。',
          '本站面向中国大陆访问者提供的仅为技术演示，不构成、也不用于提供任何经营性的即时通讯、信息发布或数据存储服务；本站没有账号体系、没有付费功能，也未就使用收取任何费用。',
          '官方实例：https://qr-live.cxs.apps.dynesshely.top 。源代码公开在 https://github.com/Dynesshely/Live-QR ，以 AGPL-3.0 发布。',
        ],
      },
      {
        heading: '二、数据与隐私',
        paragraphs: [
          '站内的通道数据没有数据库：分享码与最近一次上传的文本保存在服务器进程的内存中，默认 30 分钟无上传即自动过期（部署方可在 60–86400 秒之间调整），服务器进程重启后所有通道立即消失。通道数据不做备份，过期后也无法找回。审计日志是另一份独立的磁盘副本，见下一段。',
          '但为了安全审计、限流取证与依法配合主管部门，服务端会把每次上传的文本原文、上传者 IP、接收者（观看者）IP 与双方的 User-Agent 追加写入磁盘上的审计日志文件（按 UTC 日期分文件，一行一个 JSON，仅服务账号可读写）。该日志独立于内存中的通道：通道过期或服务重启都不会删除已写入的日志，保留 8 个月（243 天；部署方可通过配置调整该期限）后自动删除。',
          '上传的文本会被广播给持有同一分享码的所有观看者。分享码是 8 位数字，存在被猜中的可能，请不要把分享码当作访问控制手段来保护敏感信息。',
        ],
        bullets: [
          '审计日志还会记录观看者的连接（IP、User-Agent）与断开（IP、会话时长），以及服务启动时的审计目录与保留天数配置。',
          '审计日志仅用于上述安全审计、限流取证与依法配合主管部门，不对用户提供查询、导出或恢复功能。请勿上传任何你不愿被保存的内容。',
          '除审计日志外，运行日志还记录每次请求的方法、路径、状态码、处理耗时、客户端 IP 与 User-Agent，以及通道创建与验证、上传成功、请求限流、WebSocket 连接与断开等业务事件，用于限流、故障排查与安全审计。',
          '浏览器本地只保存两类数据：界面偏好（主题与语言，localStorage 键 app-preferences），以及条款同意记录（localStorage 键 live-qr-legal-consent-v1，内容为同意时间戳）。本次会话内关闭顶部提示的状态保存在 sessionStorage。',
          '本站不使用 Cookie，不接入第三方统计、广告或追踪脚本，也不建立用户画像。',
          '除完成上述文本投递所必需、或法律法规另有要求外，我们不会主动向第三方提供你的内容。',
        ],
      },
      {
        heading: '三、可接受使用政策',
        paragraphs: ['你只能将本站用于合法用途，并对上传的全部内容负责。'],
        bullets: [
          '禁止上传、传输或展示违反中华人民共和国法律法规及你所在地法律的内容，包括但不限于危害国家安全、涉恐涉暴、淫秽色情、赌博、诈骗、侵犯他人隐私或知识产权的信息。',
          '禁止将本站用于规避监管、非法经营、发送垃圾信息，或作为任何违法活动的通讯、指挥、接头工具。',
          '禁止上传密码、私钥、助记词、短信验证码、身份证件、银行卡号、医疗记录等敏感个人信息；本站不具备保护此类信息的能力。',
          '你应自行判断内容的敏感性：审计日志会保留文本原文 8 个月，请勿上传你不愿被保存的内容。',
          '禁止对本站进行撞码、爬取、拒绝服务攻击、绕过限流或其它滥用行为。',
          '对违反上述规则的通道，我们可随时终止或删除，并保留依法追究责任的权利。',
        ],
      },
      {
        heading: '四、免责与责任限制',
        paragraphs: [
          '本站按「现状」和「现有」提供，不作任何明示或默示的担保，包括但不限于可用性、连续性、及时性、准确性、不中断或无差错。',
          '本站是演示环境：通道可能随时过期、被清理，或因进程重启、网络故障、浏览器或设备问题而丢失。我们不承担因数据丢失造成的任何责任。',
          '在适用法律允许的最大范围内，对于因使用或无法使用本站而产生的任何直接、间接、附带、特殊或后果性损失，我们不承担责任。',
          '你因违反法律法规或本条款而导致的第三方索赔、行政处罚或损失，由你自行承担。',
        ],
      },
      {
        heading: '五、开源协议说明',
        paragraphs: [
          '本站源代码以 GNU Affero General Public License v3.0（AGPL-3.0）发布，仓库地址：https://github.com/Dynesshely/Live-QR 。你可以依该协议使用、修改和分发本站代码。',
          'AGPL-3.0 第 13 条要求：若你修改本程序并让它以网络服务方式向远程用户提供交互，必须向这些用户提供获取对应源代码的途径。官方实例遵守该条，源码即上述仓库地址。',
          '自行部署本站实例的运营者，对其部署行为自行承担全部责任，包括所在地的备案、内容管理与数据合规义务。本条款仅描述官方实例。',
        ],
      },
    ],
  },
};

const en: LegalCopy = {
  banner: {
    title: 'Technical demo — do not use for unlawful purposes',
    body: [
      'Technical demo: a channel expires after about 30 minutes without an upload, but for security auditing the relayed text and the IP addresses of the uploader and the recipient are also written to a disk log and kept for 8 months (243 days).',
      'Never upload anything you would not want to be stored (passwords, one-time codes, ID numbers and the like); anyone holding the 8-digit share code can see that text.',
    ],
    dismissLabel: 'Dismiss this notice for this session',
  },
  links: { viewTerms: 'View full terms' },
  consent: {
    title: 'Please read before using',
    body: [
      'This site is an open-source technical demo of real-time QR code relay. It is not a messaging service, provides no storage or backup service to users, and offers no guarantee of availability.',
      'By continuing, you confirm that you have read and agree to the points below and to the full terms.',
    ],
    bullets: [
      'Channel content stays in server memory for about 30 minutes (a channel expires automatically after 30 minutes without an upload by default and is lost on restart). Separately, an audit log keeps the relayed text and the IP addresses of the uploader and the recipient on disk for 8 months (243 days).',
      'Anyone with the 8-digit share code can see the text you upload. Do not upload passwords, one-time codes, ID numbers, bank card numbers or other sensitive data.',
      'Uploading or sharing unlawful content, or using this site for any unlawful purpose, is prohibited; offending channels may be terminated at any time.',
      'The server writes the full text of every upload, the uploader IP, the recipient (viewer) IP and the User-Agents to a disk audit log, keeps it for 8 months (243 days) and then deletes it automatically. It is used only for security auditing, rate-limit forensics and lawful cooperation with the competent authorities.',
      'Therefore never upload anything you would not want to be stored (including passwords, one-time codes, ID numbers and bank card numbers).',
    ],
    agreeLabel: 'I have read and agree',
    laterLabel: 'Not now',
  },
  terms: {
    title: 'Terms of Service and Privacy Notice',
    updatedAt: 'Last updated: 2026-10-30',
    acknowledgeLabel: 'I have read this',
    closeLabel: 'Close terms',
    sections: [
      {
        heading: '1. What this service is',
        paragraphs: [
          'Live QR is an open-source technical demo of real-time QR code relay. The upload side scans a QR code with the browser camera and sends the decoded text to the server; the viewer side enters an 8-digit share code and sees that text redrawn as a QR code in real time. Uploader and viewer are two modes of the same web application: there is no native app and no database.',
          'For visitors in mainland China this site is provided solely as a technical demonstration. It does not constitute, and is not used to provide, any commercial messaging, publishing or data-storage service. There are no accounts, no paid features and no fees of any kind.',
          'Official instance: https://qr-live.cxs.apps.dynesshely.top . Source code: https://github.com/Dynesshely/Live-QR , released under AGPL-3.0.',
        ],
      },
      {
        heading: '2. Data and privacy',
        paragraphs: [
          'The channel data has no database: share codes and the latest uploaded text are held in the memory of the server process. A channel expires automatically after 30 minutes without an upload by default (deployments may set this between 60 and 86,400 seconds), and every channel disappears when the server process restarts. Channel data is not backed up and cannot be recovered once it has expired. The audit log is a separate copy on disk, described below.',
          'However, for security auditing, rate-limit forensics and lawful cooperation with the competent authorities, the server appends to a disk audit log the full text of every upload, the uploader IP, the recipient (viewer) IP and the User-Agents of both. The log is split into one JSON-lines file per UTC date, readable and writable only by the service account. It is independent of the in-memory channel: expiring a channel or restarting the service never deletes entries already written, and files are kept for 8 months (243 days; the operator may adjust this period) before being deleted automatically.',
          'Uploaded text is broadcast to every viewer holding the same share code. The code is 8 digits long and can be guessed, so do not treat it as an access-control mechanism for sensitive information.',
        ],
        bullets: [
          'The audit log also records viewer connections (IP, User-Agent) and disconnections (IP, session duration), plus the configured audit directory and retention period at start-up.',
          'The audit log is used only for the security auditing, rate-limit forensics and lawful cooperation described above; it is not available to users for query, export or recovery. Never upload anything you would not want to be stored.',
          'Apart from the audit log, runtime logs record the method, path, status code, processing time, client IP and User-Agent of every request, plus business events (channel creation and verification, successful uploads, rate limiting, WebSocket connect/disconnect) for rate limiting, troubleshooting and security auditing.',
          'The browser stores only two kinds of data locally: interface preferences (theme and language, localStorage key app-preferences) and your consent record (localStorage key live-qr-legal-consent-v1, holding a timestamp). Dismissing the top notice for the current session is stored in sessionStorage.',
          'This site sets no cookies and loads no third-party analytics, advertising or tracking scripts; no user profiles are built.',
          'We do not proactively provide your content to third parties, except as necessary to deliver the text as described above or as required by law.',
        ],
      },
      {
        heading: '3. Acceptable use',
        paragraphs: [
          'You may use this site only for lawful purposes, and you are responsible for everything you upload.',
        ],
        bullets: [
          "Do not upload, transmit or display content that violates the laws of the People's Republic of China or of your own jurisdiction, including content that endangers national security, promotes terrorism or violence, is obscene, involves gambling or fraud, or infringes privacy or intellectual-property rights.",
          'Do not use this site to evade supervision, operate an unlawful business, send spam, or as a channel for any unlawful activity.',
          'Do not upload passwords, private keys, recovery phrases, one-time codes, identity documents, bank card numbers, medical records or other sensitive personal data; this site cannot protect such information.',
          'Judge the sensitivity of your content yourself: the audit log keeps the full text for 8 months, so never upload anything you would not want to be stored.',
          'Do not probe share codes at scale, scrape, launch denial-of-service attacks, bypass rate limits or otherwise abuse the service.',
          'We may terminate or delete any channel that breaks these rules, and we reserve all lawful remedies.',
        ],
      },
      {
        heading: '4. Disclaimer and limitation of liability',
        paragraphs: [
          'The site is provided "as is" and "as available", without any express or implied warranty, including availability, continuity, timeliness, accuracy, uninterrupted operation or freedom from errors.',
          'This is a demonstration environment: channels may expire or be purged at any time, and may be lost because of a process restart, network failure, browser or device problem. We accept no liability for any loss of data.',
          'To the maximum extent permitted by applicable law, we are not liable for any direct, indirect, incidental, special or consequential loss arising from the use of, or inability to use, this site.',
          'You are solely responsible for any third-party claim, administrative penalty or loss resulting from your breach of law or of these terms.',
        ],
      },
      {
        heading: '5. Open-source licence',
        paragraphs: [
          'The source code is released under the GNU Affero General Public License v3.0 (AGPL-3.0): https://github.com/Dynesshely/Live-QR . You may use, modify and distribute it under that licence.',
          'Section 13 of AGPL-3.0 requires that if you modify the program and make it interact with remote users over a network, you must offer those users a way to obtain the Corresponding Source. The official instance complies; the repository above is that source.',
          'Operators who deploy their own instance bear full responsibility for their deployment, including any local filing (ICP), content-management and data-compliance obligations. These terms describe the official instance only.',
        ],
      },
    ],
  },
};

const ja: LegalCopy = {
  banner: {
    title: '技術デモ · 違法な用途には使用しないでください',
    body: [
      '技術デモ：チャネルの内容はアップロードがないまま約 30 分で失効しますが、セキュリティ監査のため、中継されたテキストとアップロード者・受信者双方の IP アドレスをディスク上のログに保存し、8 か月（243 日）間保持します。',
      '保存されたくない内容（パスワード、ワンタイムコード、身分証明書番号など）はアップロードしないでください。8 桁の共有コードを知っている人は誰でもそのテキストを閲覧できます。',
    ],
    dismissLabel: 'この通知を今回のセッションのみ閉じる',
  },
  links: { viewTerms: '利用規約全文を見る' },
  consent: {
    title: 'ご利用の前にお読みください',
    body: [
      '本サイトはリアルタイム QR コード中継のオープンソース技術デモです。通信サービスではなく、利用者への保存・バックアップサービスも提供せず、可用性も保証しません。',
      'そのまま利用を続けることで、以下の要点および利用規約全文に同意したものとみなします。',
    ],
    bullets: [
      'チャネルの内容はサーバーのメモリ上に約 30 分保持されます（アップロードがないまま既定の 30 分で失効し、再起動で失われます）。これとは別に、監査ログとして中継テキストとアップロード者・受信者双方の IP アドレスをディスクに保存し、8 か月（243 日）間保持します。',
      '8 桁の共有コードを知っている人は誰でもアップロードされたテキストを閲覧できます。パスワード、ワンタイムコード、身分証明書番号、クレジットカード番号などの機密情報はアップロードしないでください。',
      '違法または公序良俗に反する内容のアップロード・送信は禁止します。違反したチャネルはいつでも停止される場合があります。',
      'サーバーはアップロードごとにテキスト原文、アップロード者の IP、受信者（閲覧者）の IP、双方の User-Agent をディスク上の監査ログに記録し、8 か月（243 日）間保持した後に自動削除します。用途はセキュリティ監査、レート制限の証跡、所管当局への法令に基づく協力に限られます。',
      'したがって、保存されたくない内容（パスワード、ワンタイムコード、身分証明書番号、クレジットカード番号など）はアップロードしないでください。',
    ],
    agreeLabel: '内容を確認し、同意します',
    laterLabel: '後で',
  },
  terms: {
    title: '利用規約およびプライバシーについて',
    updatedAt: '最終更新日：2026-10-30',
    acknowledgeLabel: '確認しました',
    closeLabel: '利用規約を閉じる',
    sections: [
      {
        heading: '一、サービスの性質',
        paragraphs: [
          'Live QR は、リアルタイム QR コード中継のオープンソース技術デモです。アップロード側はブラウザのカメラで QR コードを読み取り、解読したテキストをサーバーへ送信します。閲覧側は 8 桁の共有コードを入力すると、そのテキストをリアルタイムで QR コードとして再描画して表示します。アップロード側と閲覧側は同一のウェブアプリの 2 つのモードであり、ネイティブアプリもデータベースもありません。',
          '中国大陸からの訪問者に対して、本サイトは技術デモとしてのみ提供されます。商業的なメッセージング、情報発信、データ保存サービスを構成するものではなく、またそのために使用されるものでもありません。アカウント機能や有料機能はなく、利用料も一切いただきません。',
          '公式インスタンス：https://qr-live.cxs.apps.dynesshely.top 。ソースコード：https://github.com/Dynesshely/Live-QR （AGPL-3.0）。',
        ],
      },
      {
        heading: '二、データとプライバシー',
        paragraphs: [
          'チャネルのデータにデータベースはありません。共有コードと直近にアップロードされたテキストはサーバープロセスのメモリ上に保持されます。チャネルは既定でアップロードがないまま 30 分経過すると自動的に失効し（60〜86,400 秒の範囲で設定可能）、プロセスを再起動するとすべてのチャネルが直ちに消えます。チャネルデータのバックアップは行わず、失効後は復元できません。監査ログは別個のディスク上のコピーで、次の段落で説明します。',
          'ただし、セキュリティ監査、レート制限の証跡、所管当局への法令に基づく協力のため、サーバーはアップロードごとにテキスト原文、アップロード者の IP、受信者（閲覧者）の IP、双方の User-Agent をディスク上の監査ログに追記します。ログは UTC 日付ごとのファイル（1 行 1 JSON、サービスアカウントのみ読み書き可能）に分かれ、メモリ上のチャネルとは独立しています。チャネルの失効やサービスの再起動で既に書き込まれたログが消えることはなく、8 か月（243 日。運用者は設定で変更可能）保持した後に自動削除されます。',
          'アップロードされたテキストは、同じ共有コードを持つすべての閲覧者に配信されます。共有コードは 8 桁の数字であり推測され得るため、機密情報の保護を目的としたアクセス制御として扱わないでください。',
        ],
        bullets: [
          '監査ログには、閲覧者の接続（IP、User-Agent）と切断（IP、接続時間）、起動時の監査ディレクトリ・保持日数の設定も記録されます。',
          '監査ログは上記のセキュリティ監査、レート制限の証跡、法令に基づく協力にのみ使用し、利用者向けの照会・エクスポート・復元機能は提供しません。保存されたくない内容はアップロードしないでください。',
          '監査ログとは別に、実行ログには各リクエストのメソッド、パス、ステータスコード、処理時間、クライアント IP、User-Agent と、業務イベント（チャネルの作成・検証、アップロード成功、レート制限、WebSocket の接続・切断など）を記録します。用途はレート制限、障害調査、セキュリティ監査です。',
          'ブラウザに保存されるのは 2 種類のみです。表示設定（テーマと言語、localStorage キー app-preferences）と、規約への同意記録（localStorage キー live-qr-legal-consent-v1、同意時刻）です。今回のセッションで上部の通知を閉じた状態は sessionStorage に保存されます。',
          'Cookie は使用せず、第三者の解析・広告・トラッキングのスクリプトも読み込みません。ユーザープロファイルの作成も行いません。',
          '上記のテキスト中継に必要な場合、または法令上必要な場合を除き、第三者へ積極的に内容を提供することはありません。',
        ],
      },
      {
        heading: '三、利用ポリシー',
        paragraphs: [
          '本サイトは適法な目的にのみ使用でき、アップロードするすべての内容について利用者が責任を負います。',
        ],
        bullets: [
          '中華人民共和国の法令および利用者の所在地の法令に違反する内容（国家の安全を害するもの、テロや暴力を助長するもの、わいせつ、賭博、詐欺、プライバシーや知的財産権の侵害など）をアップロード、送信、表示してはなりません。',
          '監督の回避、違法な営業、スパムの送信、その他違法行為の連絡・指示・受け渡しの手段として本サイトを使用してはなりません。',
          'パスワード、秘密鍵、リカバリーフレーズ、ワンタイムコード、身分証明書、クレジットカード番号、医療記録などの機密性の高い個人情報をアップロードしてはなりません。本サイトはこれらを保護する能力を持ちません。',
          '内容の機密性は自ら判断してください。監査ログはテキスト原文を 8 か月保持するため、保存されたくない内容はアップロードしないでください。',
          '共有コードの総当たり、スクレイピング、サービス妨害攻撃、レート制限の回避、その他の濫用行為を行ってはなりません。',
          'これらの規則に違反するチャネルはいつでも停止・削除することがあり、法的措置を講じる権利を留保します。',
        ],
      },
      {
        heading: '四、免責および責任の制限',
        paragraphs: [
          '本サイトは「現状有姿」かつ「提供可能な範囲」で提供され、可用性、継続性、適時性、正確性、中断や誤りがないことを含め、明示・黙示を問わずいかなる保証も行いません。',
          '本サイトはデモ環境です。チャネルはいつでも失効・削除される可能性があり、プロセスの再起動、ネットワーク障害、ブラウザや端末の問題により失われることがあります。データの消失について当方は責任を負いません。',
          '適用法令が許す最大限の範囲で、本サイトの利用または利用不能に起因する直接的、間接的、付随的、特別または結果的な損害について、当方は責任を負いません。',
          '法令または本規約の違反により生じた第三者からの請求、行政上の処分、損害については、利用者が自ら責任を負います。',
        ],
      },
      {
        heading: '五、オープンソースライセンスについて',
        paragraphs: [
          '本サイトのソースコードは GNU Affero General Public License v3.0（AGPL-3.0）で公開されています： https://github.com/Dynesshely/Live-QR 。同ライセンスの下で使用、変更、配布できます。',
          'AGPL-3.0 第 13 条は、本プログラムを改変してネットワーク経由で遠隔の利用者に提供する場合、それらの利用者に対応するソースコードを取得する手段を提供することを求めています。公式インスタンスはこれに従い、上記リポジトリをソースとして提示します。',
          '独自にインスタンスを運用する者は、その運用（現地の届出・登録、コンテンツ管理、データ保護に関する義務を含む）について自ら責任を負います。本規約は公式インスタンスのみを対象とします。',
        ],
      },
    ],
  },
};

/**
 * 三种语言的合规文案。键与 `Locale`（'zh' | 'en' | 'ja'）一一对应。
 */
export const LEGAL_CONTENT: Record<Locale, LegalCopy> = { zh, en, ja };
