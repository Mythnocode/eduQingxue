type Env = {
  DB: D1Database;
  BAIDU_OCR_API_KEY: string;
  BAIDU_OCR_SECRET_KEY: string;
  DEEPSEEK_API_KEY: string;
  GEEKSPACE_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  ALLOWED_ORIGIN?: string;
  BAIDU_OCR_MODE?: 'auto' | 'accurate_basic' | 'formula';
};

type AuthUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
};

type AnalysisResult = {
  summary: string;
  subject?: string;
  grade?: string;
  questionCount?: number;
  knowledgeCoverage: Array<{
    name: string;
    count: number;
    importance?: 'low' | 'medium' | 'high';
  }>;
  difficultyDistribution: {
    easy: number;
    medium: number;
    hard: number;
  };
  questionTypes: Array<{
    type: string;
    count: number;
  }>;
  weakPoints: string[];
  lectureSuggestions: string[];
  originalTextPreview: string;
};

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_ANALYSIS_TEXT_LENGTH = 12000;
const SESSION_COOKIE = 'paper_insight_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 100000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = getCorsHeaders(env, request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true }, 200, corsHeaders);
    }

    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      try {
        return await handleRegister(request, env, corsHeaders);
      } catch (error) {
        return json({ message: getErrorMessage(error, '注册失败，请稍后重试。') }, 500, corsHeaders);
      }
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        return await handleLogin(request, env, corsHeaders);
      } catch (error) {
        return json({ message: getErrorMessage(error, '登录失败，请稍后重试。') }, 500, corsHeaders);
      }
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      try {
        return await handleLogout(request, env, corsHeaders);
      } catch (error) {
        return json({ message: getErrorMessage(error, '退出登录失败，请稍后重试。') }, 500, corsHeaders);
      }
    }

    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      try {
        const user = await getCurrentUser(request, env);
        return json({ user }, 200, corsHeaders);
      } catch (error) {
        return json({ message: getErrorMessage(error, '读取登录状态失败。') }, 500, corsHeaders);
      }
    }

    if (url.pathname === '/api/ocr' && request.method === 'POST') {
      try {
        await requireUser(request, env);
        return await handleOcr(request, env, corsHeaders);
      } catch (error) {
        return authAwareError(error, 'OCR 识别失败，请稍后重试。', corsHeaders);
      }
    }

    if (url.pathname === '/api/analyze-text' && request.method === 'POST') {
      try {
        await requireUser(request, env);
        return await handleAnalyzeText(request, env, corsHeaders);
      } catch (error) {
        return authAwareError(error, '分析失败，请稍后重试。', corsHeaders);
      }
    }

    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      try {
        await requireUser(request, env);
        return await handleAnalyzeImage(request, env, corsHeaders);
      } catch (error) {
        return authAwareError(error, '分析失败，请稍后重试。', corsHeaders);
      }
    }

    if (url.pathname === '/api/analyze-multimodal' && request.method === 'POST') {
      try {
        await requireUser(request, env);
        return await handleAnalyzeMultimodal(request, env, corsHeaders);
      } catch (error) {
        return authAwareError(error, '多模态分析失败，请稍后重试。', corsHeaders);
      }
    }

    return json({ message: 'Not found' }, 404, corsHeaders);
  },
};

async function handleRegister(request: Request, env: Env, corsHeaders: HeadersInit): Promise<Response> {
  assertDatabaseConfigured(env);
  const payload = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown; name?: unknown } | null;
  const email = normalizeEmail(payload?.email);
  const password = typeof payload?.password === 'string' ? payload.password : '';
  const name = normalizeName(payload?.name, email);

  if (!email || !isValidEmail(email)) {
    return json({ message: '请输入有效邮箱。' }, 400, corsHeaders);
  }

  if (password.length < 8) {
    return json({ message: '密码至少需要 8 位。' }, 400, corsHeaders);
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (existing) {
    return json({ message: '该邮箱已注册，请直接登录。' }, 409, corsHeaders);
  }

  const userId = crypto.randomUUID();
  const passwordRecord = await hashPassword(password);
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO users (id, email, name, password_hash, password_salt, password_iterations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(userId, email, name, passwordRecord.hash, passwordRecord.salt, PASSWORD_ITERATIONS, now, now)
    .run();

  const user = { id: userId, email, name, createdAt: now };
  return withSessionCookie(request, env, corsHeaders, user);
}

async function handleLogin(request: Request, env: Env, corsHeaders: HeadersInit): Promise<Response> {
  assertDatabaseConfigured(env);
  const payload = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = normalizeEmail(payload?.email);
  const password = typeof payload?.password === 'string' ? payload.password : '';

  if (!email || !password) {
    return json({ message: '请输入邮箱和密码。' }, 400, corsHeaders);
  }

  const row = await env.DB.prepare(
    'SELECT id, email, name, password_hash, password_salt, password_iterations, created_at FROM users WHERE email = ?',
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      name: string;
      password_hash: string;
      password_salt: string;
      password_iterations: number;
      created_at: string;
    }>();

  if (!row || !(await verifyPassword(password, row.password_salt, row.password_hash, row.password_iterations))) {
    return json({ message: '邮箱或密码不正确。' }, 401, corsHeaders);
  }

  return withSessionCookie(request, env, corsHeaders, {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
  });
}

async function handleLogout(request: Request, env: Env, corsHeaders: HeadersInit): Promise<Response> {
  assertDatabaseConfigured(env);
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }

  return json(
    { ok: true },
    200,
    {
      ...corsHeaders,
      'Set-Cookie': clearSessionCookie(request),
    },
  );
}

async function withSessionCookie(request: Request, env: Env, corsHeaders: HeadersInit, user: AuthUser): Promise<Response> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? OR expires_at <= ?').bind(user.id, now.toISOString()).run();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), user.id, tokenHash, now.toISOString(), expiresAt)
    .run();

  return json(
    { user },
    200,
    {
      ...corsHeaders,
      'Set-Cookie': makeSessionCookie(request, token),
    },
  );
}

async function getCurrentUser(request: Request, env: Env): Promise<AuthUser | null> {
  assertDatabaseConfigured(env);
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    [
      'SELECT users.id, users.email, users.name, users.created_at',
      'FROM sessions',
      'JOIN users ON users.id = sessions.user_id',
      'WHERE sessions.token_hash = ? AND sessions.expires_at > ?',
      'LIMIT 1',
    ].join(' '),
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{ id: string; email: string; name: string; created_at: string }>();

  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}

async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const user = await getCurrentUser(request, env);
  if (!user) throw new AuthError('请先登录后再使用该功能。');
  return user;
}

async function handleOcr(request: Request, env: Env, corsHeaders: HeadersInit): Promise<Response> {
  assertBaiduConfigured(env);

  const file = await readImageFile(request);
  const imageBase64 = await fileToBase64(file);
  const text = await recognizeWithBaidu(imageBase64, env);

  return json(
    {
      text,
      textPreview: text.slice(0, 1200),
      mode: env.BAIDU_OCR_MODE || 'auto',
    },
    200,
    corsHeaders,
  );
}

async function handleAnalyzeText(request: Request, env: Env, corsHeaders: HeadersInit): Promise<Response> {
  assertDeepSeekConfigured(env);

  const payload = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof payload?.text === 'string' ? payload.text.trim() : '';

  if (!text) {
    return json({ message: '请先提供 OCR 文本或校对后的试卷文本。' }, 400, corsHeaders);
  }

  if (text.length > MAX_ANALYSIS_TEXT_LENGTH) {
    return json({ message: `文本不能超过 ${MAX_ANALYSIS_TEXT_LENGTH} 字，请分批分析。` }, 400, corsHeaders);
  }

  const result = await analyzeWithDeepSeek(text, env);
  result.originalTextPreview = text.slice(0, 1200);

  return json({ result }, 200, corsHeaders);
}

async function handleAnalyzeImage(request: Request, env: Env, corsHeaders: HeadersInit): Promise<Response> {
  assertBaiduConfigured(env);
  assertDeepSeekConfigured(env);

  const file = await readImageFile(request);
  const imageBase64 = await fileToBase64(file);
  const ocrText = await recognizeWithBaidu(imageBase64, env);
  const result = await analyzeWithDeepSeek(ocrText, env);

  result.originalTextPreview = ocrText.slice(0, 1200);

  return json({ result }, 200, corsHeaders);
}

async function handleAnalyzeMultimodal(request: Request, env: Env, corsHeaders: HeadersInit): Promise<Response> {
  assertGeekspaceConfigured(env);

  const file = await readImageFile(request);
  const imageBase64 = await fileToBase64(file);
  const mimeType = file.type || 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  const prompt = [
    '你是一个面向中小学教师的试卷分析助手。',
    '请直接根据试卷图片分析试卷，输出严格 JSON，不要输出 Markdown。',
    '只输出教学分析结果，不要评价图片质量、识别准确性或文件解析过程。',
    '如果题目信息不完整，请基于可见内容做概括性分析，重点放在知识点覆盖、题型结构、难度分布和讲评建议。',
    'JSON 字段：summary, subject, grade, questionCount, knowledgeCoverage, difficultyDistribution, questionTypes, weakPoints, lectureSuggestions。',
    'knowledgeCoverage 是数组，元素包含 name, count, importance。importance 只能是 low, medium, high。',
    'difficultyDistribution 包含 easy, medium, hard，数值为题目数量估计。',
    'questionTypes 是数组，元素包含 type, count。',
    'weakPoints 和 lectureSuggestions 都是中文字符串数组，每项不超过 40 字。',
  ].join('\n');

  const response = await fetch('https://geekspace.cloud/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GEEKSPACE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你只输出符合要求的 JSON 对象，字段缺失时使用合理默认值。',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(`多模态分析失败：${payload.error?.message || response.statusText}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('多模态分析未返回有效结果。');
  }

  const result = normalizeAnalysis(parseJsonObject(content));
  result.originalTextPreview = '';

  return json({ result }, 200, corsHeaders);
}

async function readImageFile(request: Request): Promise<File> {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!isUploadedFile(file)) {
    throw new Error('请上传试卷图片。');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('当前 MVP 仅支持 JPG、PNG、WEBP 图片。');
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error('图片不能超过 4MB，请压缩后重试。');
  }

  return file;
}

async function recognizeWithBaidu(imageBase64: string, env: Env): Promise<string> {
  const mode = env.BAIDU_OCR_MODE || 'auto';
  if (mode === 'formula') {
    return recognizeFormulaWithBaidu(imageBase64, env);
  }

  if (mode === 'auto') {
    try {
      const formulaText = await recognizeFormulaWithBaidu(imageBase64, env);
      if (looksLikeUsefulMathText(formulaText)) {
        return formulaText;
      }
    } catch {
      // 公式识别是增强能力，不稳定时自动回退到高精度文字识别。
    }
  }

  return recognizeAccurateBasicWithBaidu(imageBase64, env);
}

async function recognizeAccurateBasicWithBaidu(imageBase64: string, env: Env): Promise<string> {
  const accessToken = await getBaiduAccessToken(env);
  const body = new URLSearchParams({
    image: imageBase64,
    language_type: 'CHN_ENG',
    detect_direction: 'true',
    paragraph: 'true',
  });

  const response = await fetch(
    `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );

  const payload = (await response.json()) as {
    words_result?: Array<{ words: string }>;
    error_msg?: string;
  };

  if (!response.ok || payload.error_msg) {
    throw new Error(`百度 OCR 识别失败：${payload.error_msg || response.statusText}`);
  }

  const text = payload.words_result?.map((item) => item.words).join('\n').trim() ?? '';
  if (!text) {
    throw new Error('OCR 未识别到有效文字，请换一张更清晰的试卷图片。');
  }

  return text;
}

async function recognizeFormulaWithBaidu(imageBase64: string, env: Env): Promise<string> {
  const accessToken = await getBaiduAccessToken(env);
  const body = new URLSearchParams({
    image: imageBase64,
  });

  const response = await fetch(
    `https://aip.baidubce.com/rest/2.0/ocr/v1/formula?access_token=${accessToken}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );

  const payload = (await response.json()) as {
    words_result?: Array<{ words?: string; formula?: string }>;
    formula_result?: Array<{ words?: string; formula?: string }>;
    error_msg?: string;
  };

  if (!response.ok || payload.error_msg) {
    throw new Error(`百度公式 OCR 识别失败：${payload.error_msg || response.statusText}`);
  }

  const formulaItems = payload.formula_result ?? payload.words_result ?? [];
  const text = formulaItems
    .map((item) => item.formula || item.words || '')
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('公式 OCR 未识别到有效文字。');
  }

  return text;
}

async function getBaiduAccessToken(env: Env): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.BAIDU_OCR_API_KEY,
    client_secret: env.BAIDU_OCR_SECRET_KEY,
  });

  const response = await fetch('https://aip.baidubce.com/oauth/2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = (await response.json()) as {
    access_token?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(`百度 access_token 获取失败：${payload.error_description || response.statusText}`);
  }

  return payload.access_token;
}

async function analyzeWithDeepSeek(ocrText: string, env: Env): Promise<AnalysisResult> {
  const prompt = [
    '你是一个面向中小学教师的试卷分析助手。',
    '请根据试卷文本分析试卷，输出严格 JSON，不要输出 Markdown。',
    '只输出教学分析结果，不要评价文本来源、识别质量、OCR 准确性或文件解析过程。',
    '如果题目信息不完整，请基于可见内容做概括性分析，重点放在知识点覆盖、题型结构、难度分布和讲评建议。',
    'JSON 字段：summary, subject, grade, questionCount, knowledgeCoverage, difficultyDistribution, questionTypes, weakPoints, lectureSuggestions。',
    'knowledgeCoverage 是数组，元素包含 name, count, importance。importance 只能是 low, medium, high。',
    'difficultyDistribution 包含 easy, medium, hard，数值为题目数量估计。',
    'questionTypes 是数组，元素包含 type, count。',
    'weakPoints 和 lectureSuggestions 都是中文字符串数组，每项不超过 40 字。',
    '',
    '试卷文本：',
    ocrText.slice(0, 8000),
  ].join('\n');

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你只输出符合要求的 JSON 对象，字段缺失时使用合理默认值。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(`DeepSeek 分析失败：${payload.error?.message || response.statusText}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('DeepSeek 未返回有效分析结果。');
  }

  return normalizeAnalysis(parseJsonObject(content));
}

function parseJsonObject(content: string): Partial<AnalysisResult> {
  try {
    return JSON.parse(content) as Partial<AnalysisResult>;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('DeepSeek 返回内容不是有效 JSON。');
    }

    return JSON.parse(match[0]) as Partial<AnalysisResult>;
  }
}

function looksLikeUsefulMathText(text: string): boolean {
  const compact = text.replace(/\s/g, '');
  if (compact.length < 80) {
    return false;
  }

  const mathSignals = ['\\frac', '\\sqrt', '\\sin', '\\cos', '\\tan', '^', '_', '{', '}'];
  return mathSignals.some((signal) => compact.includes(signal));
}

function normalizeAnalysis(value: Partial<AnalysisResult>): AnalysisResult {
  return {
    summary: value.summary || '已完成试卷结构与讲评重点分析。',
    subject: value.subject || '',
    grade: value.grade || '',
    questionCount: numberOrUndefined(value.questionCount),
    knowledgeCoverage: Array.isArray(value.knowledgeCoverage) ? value.knowledgeCoverage.slice(0, 12) : [],
    difficultyDistribution: {
      easy: Number(value.difficultyDistribution?.easy ?? 0),
      medium: Number(value.difficultyDistribution?.medium ?? 0),
      hard: Number(value.difficultyDistribution?.hard ?? 0),
    },
    questionTypes: Array.isArray(value.questionTypes) ? value.questionTypes.slice(0, 12) : [],
    weakPoints: Array.isArray(value.weakPoints) ? value.weakPoints.slice(0, 8) : [],
    lectureSuggestions: Array.isArray(value.lectureSuggestions) ? value.lectureSuggestions.slice(0, 8) : [],
    originalTextPreview: '',
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function isUploadedFile(value: File | string | null): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    'size' in value &&
    'type' in value
  );
}

function assertBaiduConfigured(env: Env): void {
  assertKeys([
    ['BAIDU_OCR_API_KEY', env.BAIDU_OCR_API_KEY],
    ['BAIDU_OCR_SECRET_KEY', env.BAIDU_OCR_SECRET_KEY],
  ]);
}

function assertDeepSeekConfigured(env: Env): void {
  assertKeys([['DEEPSEEK_API_KEY', env.DEEPSEEK_API_KEY]]);
}

function assertGeekspaceConfigured(env: Env): void {
  assertKeys([['GEEKSPACE_API_KEY', env.GEEKSPACE_API_KEY]]);
}

function assertDatabaseConfigured(env: Env): void {
  if (!env.DB) {
    throw new Error('后端缺少 D1 数据库绑定：DB');
  }
}

function assertKeys(entries: Array<[string, string | undefined]>): void {
  const missing = entries.filter(([, value]) => !value).map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`后端缺少环境变量：${missing.join(', ')}`);
  }
}

function getCorsHeaders(env: Env, request: Request): HeadersInit {
  const origin = request.headers.get('Origin');
  const configuredOrigin = env.ALLOWED_ORIGIN || '*';
  const allowOrigin = configuredOrigin === '*' && origin ? origin : configuredOrigin;

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(data, {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function authAwareError(error: unknown, fallback: string, corsHeaders: HeadersInit): Response {
  if (error instanceof AuthError) {
    return json({ message: error.message }, 401, corsHeaders);
  }
  return json({ message: getErrorMessage(error, fallback) }, 500, corsHeaders);
}

class AuthError extends Error {}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeName(value: unknown, email: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  return name || email.split('@')[0] || '老师';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, saltBytes, PASSWORD_ITERATIONS);
  return {
    hash: bytesToBase64(hash),
    salt: bytesToBase64(saltBytes),
  };
}

async function verifyPassword(password: string, salt: string, expectedHash: string, iterations: number): Promise<boolean> {
  const saltBytes = base64ToBytes(salt);
  const hash = await derivePasswordHash(password, saltBytes, iterations || PASSWORD_ITERATIONS);
  return timingSafeEqual(bytesToBase64(hash), expectedHash);
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function randomToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function makeSessionCookie(request: Request, token: string): string {
  const isHttps = new URL(request.url).protocol === 'https:';
  const sameSite = isHttps ? 'None' : 'Lax';
  const secure = isHttps ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_SECONDS}; SameSite=${sameSite}${secure}`;
}

function clearSessionCookie(request: Request): string {
  const isHttps = new URL(request.url).protocol === 'https:';
  const sameSite = isHttps ? 'None' : 'Lax';
  const secure = isHttps ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=${sameSite}${secure}`;
}

function getCookie(request: Request, name: string): string {
  const cookie = request.headers.get('Cookie') || '';
  return (
    cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ''
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
