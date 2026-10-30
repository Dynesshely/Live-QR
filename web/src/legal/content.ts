import type { Locale } from '../i18n';

/**
 * 合规文案（三层提示的文本层）。
 *
 * 这里只放**纯数据**：顶部 Banner、首次确认弹窗、完整条款三段文案，中/英/日各一份。
 * 文案必须与实现保持一致 —— 本站没有数据库、通道纯内存、重启即丢，
 * 因此不能写「我们保证数据安全」这类承诺。
 *
 * 事实依据（改服务端行为时请同步改本文件）：
 * - 纯内存通道、默认 30 分钟无上传过期、TTL 可配 60–86400 秒：
 *   server/src/config.ts:33、server/src/services/channelStore.ts
 * - 访问日志字段（方法 / 路径 / 状态码 / 耗时 / 客户端 IP / User-Agent）：
 *   server/src/middleware/accessLog.ts:11-29、server/src/logger.ts:58-72、server/src/app.ts:20
 * - 业务日志字段（事件 / 时间 / 分享码 / 文本长度 / 客户端 IP，不含文本内容）：
 *   server/src/types.ts:128-141、server/src/routes/upload.ts
 *
 * 注意：访问日志是 2026-10-30 合规改造新增的中间件；若它被移除，隐私一节必须同步回退。
 * - 浏览器存储键：web/src/stores/preferences.ts:9、web/src/composables/useLegal.ts
 * - 仓库与协议：https://github.com/Dynesshely/Live-QR （AGPL-3.0）
 *
 * 注意：文案里出现「不使用 Cookie / 不接入第三方统计」是基于当前 index.html 无任何
 * 第三方脚本的事实；若将来接入统计或广告，必须先改这里。
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
      '本站是开源的实时二维码投递演示：通道数据仅存于服务器内存，服务重启后立即丢失，请勿上传敏感信息。',
      '上传内容由用户负责；持有 8 位分享码的任何人都能看到该文本。',
    ],
    dismissLabel: '本次会话内关闭提示',
  },
  links: { viewTerms: '查看完整条款' },
  consent: {
    title: '使用前请阅读',
    body: [
      '本站是一个开源的实时二维码投递技术演示，不是通讯服务，也不提供存储、备份或可用性保证。',
      '继续使用即表示你已阅读并同意下列要点与完整条款。',
    ],
    bullets: [
      '通道数据仅存于服务器内存，默认 30 分钟无上传自动过期，服务重启后全部丢失。',
      '持有 8 位分享码的任何人都能看到你上传的文本；请勿上传密码、验证码、证件号码、银行卡号等敏感信息。',
      '禁止上传或传播任何违法违规内容，禁止将本站用于非法用途；违规通道可被随时终止。',
      '服务端会记录请求元数据（方法、路径、状态码、客户端 IP、User-Agent）与业务事件，用于限流和安全审计；不记录文本内容。',
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
          '本站没有数据库。分享码与上传的文本只保存在服务器进程的内存中：默认 30 分钟无上传即自动过期（部署方可在 60–86400 秒之间调整），服务器进程重启后所有通道立即消失。我们不备份通道数据，也无法为你找回任何内容。',
          '上传的文本会被广播给持有同一分享码的所有观看者。分享码是 8 位数字，存在被猜中的可能，请不要把分享码当作访问控制手段来保护敏感信息。',
        ],
        bullets: [
          '服务端不记录文本内容。运行日志（每行一个 JSON）记录两类信息：①每次请求的方法、路径、状态码、处理耗时、客户端 IP 与 User-Agent；②业务事件（通道创建与验证、上传成功、请求限流、WebSocket 连接与断开等）的事件类型、时间、分享码与文本长度。上述日志用于限流、故障排查与安全审计，并可能在收到符合法律程序的要求时依法提供。日志保留时长由部署方设定。',
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
      'This site is an open-source demo of real-time QR code relay: channel data lives only in server memory and is lost when the process restarts. Never upload sensitive information.',
      'You are responsible for what you upload; anyone holding the 8-digit share code can see that text.',
    ],
    dismissLabel: 'Dismiss this notice for this session',
  },
  links: { viewTerms: 'View full terms' },
  consent: {
    title: 'Please read before using',
    body: [
      'This site is an open-source technical demo of real-time QR code relay. It is not a messaging service and offers no guarantee of storage, backup or availability.',
      'By continuing, you confirm that you have read and agree to the points below and to the full terms.',
    ],
    bullets: [
      'Channel data is kept in server memory only; a channel expires automatically after 30 minutes without an upload by default, and everything is lost when the process restarts.',
      'Anyone with the 8-digit share code can see the text you upload. Do not upload passwords, one-time codes, ID numbers, bank card numbers or other sensitive data.',
      'Uploading or sharing unlawful content, or using this site for any unlawful purpose, is prohibited; offending channels may be terminated at any time.',
      'The server records request metadata (method, path, status code, client IP, User-Agent) and business events for rate limiting and security auditing; it does not record the text content.',
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
          'There is no database. Share codes and uploaded text exist only in the memory of the server process. A channel expires automatically after 30 minutes without an upload by default (deployments may set this between 60 and 86,400 seconds), and every channel disappears the moment the server process restarts. We do not back up channel data and cannot recover it for you.',
          'Uploaded text is broadcast to every viewer holding the same share code. The code is 8 digits long and can be guessed, so do not treat it as an access-control mechanism for sensitive information.',
        ],
        bullets: [
          'The server does not log text content. Its runtime log (one JSON object per line) records two kinds of data: (a) for each request, the method, path, status code, processing time, client IP and User-Agent; and (b) business events (channel creation and verification, successful uploads, rate limiting, WebSocket connect/disconnect) with their event type, timestamp, share code and text length. These logs are used for rate limiting, troubleshooting and security auditing, and may be disclosed where required by a lawful process. Log retention is set by the operator.',
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
      '本サイトはリアルタイム QR コード中継のオープンソース技術デモです。チャネルのデータはサーバーのメモリ上にのみ存在し、プロセスを再起動するとすべて失われます。機密情報はアップロードしないでください。',
      'アップロードした内容については利用者が責任を負います。8 桁の共有コードを知っている人は誰でもそのテキストを閲覧できます。',
    ],
    dismissLabel: 'この通知を今回のセッションのみ閉じる',
  },
  links: { viewTerms: '利用規約全文を見る' },
  consent: {
    title: 'ご利用の前にお読みください',
    body: [
      '本サイトはリアルタイム QR コード中継のオープンソース技術デモです。通信サービスではなく、保存・バックアップ・可用性を保証するものでもありません。',
      'そのまま利用を続けることで、以下の要点および利用規約全文に同意したものとみなします。',
    ],
    bullets: [
      'チャネルのデータはサーバーのメモリ上にのみ保存されます。アップロードがないまま既定の 30 分が経過すると自動的に失効し、再起動時にはすべて失われます。',
      '8 桁の共有コードを知っている人は誰でもアップロードされたテキストを閲覧できます。パスワード、ワンタイムコード、身分証明書番号、クレジットカード番号などの機密情報はアップロードしないでください。',
      '違法または公序良俗に反する内容のアップロード・送信は禁止します。違反したチャネルはいつでも停止される場合があります。',
      'サーバーはレート制限とセキュリティ監査のために、リクエストのメタデータ（メソッド、パス、ステータスコード、クライアント IP、User-Agent）と業務イベントを記録します。テキストの内容は記録しません。',
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
          'データベースはありません。共有コードとアップロードされたテキストは、サーバープロセスのメモリ上にのみ存在します。チャネルは既定でアップロードがないまま 30 分経過すると自動的に失効し（60〜86,400 秒の範囲で設定可能）、サーバープロセスを再起動するとすべてのチャネルが直ちに消えます。チャネルデータのバックアップは行わず、復元することもできません。',
          'アップロードされたテキストは、同じ共有コードを持つすべての閲覧者に配信されます。共有コードは 8 桁の数字であり推測され得るため、機密情報の保護を目的としたアクセス制御として扱わないでください。',
        ],
        bullets: [
          'サーバーはテキストの内容を記録しません。実行ログ（1 行 1 JSON）には 2 種類の情報を記録します。①各リクエストのメソッド、パス、ステータスコード、処理時間、クライアント IP、User-Agent。②業務イベント（チャネルの作成・検証、アップロード成功、レート制限、WebSocket の接続・切断など）のイベント種別、時刻、共有コード、テキスト長。これらのログはレート制限、障害調査、セキュリティ監査に使用し、法令に基づく適法な手続きにより開示する場合があります。ログの保存期間は運用者が定めます。',
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
