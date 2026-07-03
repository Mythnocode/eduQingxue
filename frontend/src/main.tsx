import React from 'react';
import ReactDOM from 'react-dom/client';
import ReactECharts from 'echarts-for-react';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth/mammoth.browser';
import { readSheet } from 'read-excel-file/browser';
import {
  AlertCircle,
  BarChart3,
  Bell,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Filter,
  Image as ImageIcon,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  Mail,
  Mic,
  MoreHorizontal,
  PenTool,
  Phone,
  Plus,
  Save,
  Scan,
  ScanLine,
  Search,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  Target,
  TextSearch,
  TrendingDown,
  TrendingUp,
  UploadCloud,
  User,
  UserCircle,
  UserPlus,
  Users,
} from 'lucide-react';
import './styles.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();

type AnalysisResult = {
  summary: string;
  subject?: string;
  grade?: string;
  questionCount?: number;
  knowledgeCoverage: Array<{ name: string; count: number; importance?: 'low' | 'medium' | 'high' }>;
  difficultyDistribution: { easy: number; medium: number; hard: number };
  questionTypes: Array<{ type: string; count: number }>;
  weakPoints: string[];
  lectureSuggestions: string[];
  originalTextPreview: string;
};

type LearningRecord = {
  className: string;
  studentName: string;
  questionId: string;
  knowledgePoint: string;
  score: number;
  fullScore: number;
};

type Metric = { name: string; score: number; fullScore: number; mastery: number; records: number };
type ClassMetric = Metric & { students: number };
type HeatCell = { className: string; questionId: string; wrongCount: number; knowledgePoint: string };

type DashboardMetrics = {
  records: LearningRecord[];
  classCount: number;
  studentCount: number;
  averageMastery: number;
  weakKnowledge: Metric[];
  classMetrics: ClassMetric[];
  questionWeakness: Metric[];
  heatmap: HeatCell[];
  classes: string[];
  questions: string[];
};

type LoadingStage = 'idle' | 'learning' | 'extract' | 'analysis';
type ActiveModule = 'dashboard' | 'exam' | 'grading' | 'students' | 'settings';
type OcrResponse = { text: string };
type AnalysisResponse = { result: AnalysisResult };
type NavItem = { id: ActiveModule; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> };
type AuthUser = { id: string; email: string; name: string; createdAt: string };
type AuthMode = 'login' | 'register';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

const demoRecords: LearningRecord[] = [
  ['高二（3）班', '李明宇', '1', '代数运算', 5, 5],
  ['高二（3）班', '王语嫣', '1', '代数运算', 4, 5],
  ['高二（3）班', '张浩然', '2', '函数单调性', 3, 8],
  ['高二（3）班', '林子萱', '2', '函数单调性', 6, 8],
  ['高二（3）班', '陈家辉', '3', '立体几何', 4, 8],
  ['高二（3）班', '刘心怡', '3', '立体几何', 6, 8],
  ['高二（4）班', '周承泽', '1', '代数运算', 5, 5],
  ['高二（4）班', '许星然', '2', '函数单调性', 4, 8],
  ['高二（4）班', '何雨桐', '3', '立体几何', 5, 8],
  ['高二（4）班', '沈知远', '4', '圆锥曲线', 5, 10],
  ['高二（3）班', '李明宇', '4', '圆锥曲线', 7, 10],
  ['高二（3）班', '王语嫣', '5', '概率分布', 8, 10],
  ['高二（4）班', '许星然', '5', '概率分布', 9, 10],
].map(([className, studentName, questionId, knowledgePoint, score, fullScore]) => ({
  className: String(className),
  studentName: String(studentName),
  questionId: String(questionId),
  knowledgePoint: String(knowledgePoint),
  score: Number(score),
  fullScore: Number(fullScore),
}));

const fallbackMetrics = buildDashboardMetrics(demoRecords);

function App() {
  const [activeModule, setActiveModule] = React.useState<ActiveModule>('dashboard');
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = React.useState<AuthMode>('login');
  const [authLoading, setAuthLoading] = React.useState(true);
  const [authSubmitting, setAuthSubmitting] = React.useState(false);
  const [authError, setAuthError] = React.useState('');
  const [metrics, setMetrics] = React.useState<DashboardMetrics | null>(null);
  const [learningFileName, setLearningFileName] = React.useState('');
  const [paperFile, setPaperFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState('');
  const [paperText, setPaperText] = React.useState('');
  const [textSource, setTextSource] = React.useState('');
  const [result, setResult] = React.useState<AnalysisResult | null>(null);
  const [error, setError] = React.useState('');
  const [loadingStage, setLoadingStage] = React.useState<LoadingStage>('idle');

  React.useEffect(() => {
    void loadCurrentUser();
  }, []);

  React.useEffect(() => {
    if (!paperFile || !paperFile.type.startsWith('image/')) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(paperFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [paperFile]);

  const loadCurrentUser = async () => {
    setAuthLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: 'include' });
      if (!response.ok) throw new Error('读取登录状态失败。');
      const payload = (await response.json()) as { user: AuthUser | null };
      setUser(payload.user);
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  };

  const submitAuth = async (payload: { email: string; password: string; name?: string }) => {
    setAuthSubmitting(true);
    setAuthError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { user?: AuthUser; message?: string } | null;
      if (!response.ok || !body?.user) throw new Error(body?.message || '登录失败，请稍后重试。');
      setUser(body.user);
      setActiveModule('dashboard');
    } catch (currentError) {
      setAuthError(currentError instanceof Error ? currentError.message : '登录失败，请稍后重试。');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const logout = async () => {
    await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => null);
    setUser(null);
    setPaperText('');
    setResult(null);
    setActiveModule('dashboard');
  };

  const handleLearningFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoadingStage('learning');
    setError('');
    try {
      const records = await readLearningRecords(file);
      setMetrics(buildDashboardMetrics(records));
      setLearningFileName(file.name);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : '学情数据解析失败，请检查表格格式。');
    } finally {
      setLoadingStage('idle');
    }
  };

  const handlePaperFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setPaperFile(selected);
    setPaperText('');
    setTextSource('');
    setResult(null);
    setError('');
  };

  const extractPaperText = async () => {
    if (!paperFile) {
      setError('请先上传试卷文件。');
      return;
    }
    setLoadingStage('extract');
    setError('');
    setResult(null);
    try {
      const kind = getFileKind(paperFile);
      if (kind === 'image') {
        setPaperText(await recognizeImage(paperFile));
        setTextSource('图片 OCR');
      } else if (kind === 'pdf') {
        setPaperText(await extractPdfText(paperFile));
        setTextSource('PDF 文本直读');
      } else if (kind === 'docx') {
        setPaperText(await extractDocxText(paperFile));
        setTextSource('Word 文本直读');
      } else {
        throw new Error('暂不支持该文件类型，请上传图片、PDF 或 DOCX。');
      }
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : '文本提取失败，请稍后重试。');
    } finally {
      setLoadingStage('idle');
    }
  };

  const analyzeText = async () => {
    const text = paperText.trim();
    if (!text) {
      setError('请先提取文本，或直接粘贴试卷文本。');
      return;
    }
    setLoadingStage('analysis');
    setError('');
    setResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/analyze-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message || '分析失败，请稍后重试。');
      setResult((payload as AnalysisResponse).result);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : '分析失败，请稍后重试。');
    } finally {
      setLoadingStage('idle');
    }
  };

  if (authLoading) {
    return (
      <div className="auth-loading">
        <Loader2 className="spin" size={34} />
        <span>正在进入工作台...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthPage mode={authMode} error={authError} isSubmitting={authSubmitting} onModeChange={setAuthMode} onSubmit={submitAuth} />;
  }

  return (
    <div className="app-frame">
      <Sidebar activeModule={activeModule} onNavigate={setActiveModule} />
      <section className="main-area">
        <Topbar user={user} onOpenSettings={() => setActiveModule('settings')} onLogout={logout} />
        <main className="content-scroll">
          {error && <p className="global-error">{error}</p>}
          {activeModule === 'dashboard' && (
            <LearningDashboard
              metrics={metrics}
              fileName={learningFileName}
              isLoading={loadingStage === 'learning'}
              onFileChange={handleLearningFile}
            />
          )}
          {activeModule === 'exam' && (
            <ExamAnalysis
              file={paperFile}
              previewUrl={previewUrl}
              paperText={paperText}
              textSource={textSource}
              result={result}
              isExtractLoading={loadingStage === 'extract'}
              isAnalysisLoading={loadingStage === 'analysis'}
              onFileChange={handlePaperFile}
              onExtract={extractPaperText}
              onAnalyze={analyzeText}
              onTextChange={setPaperText}
            />
          )}
          {activeModule === 'grading' && <SmartGrading />}
          {activeModule === 'students' && <StudentManagement metrics={metrics ?? fallbackMetrics} />}
          {activeModule === 'settings' && <SettingsPage />}
        </main>
      </section>
    </div>
  );
}

function AuthPage({
  mode,
  error,
  isSubmitting,
  onModeChange,
  onSubmit,
}: {
  mode: AuthMode;
  error: string;
  isSubmitting: boolean;
  onModeChange: (mode: AuthMode) => void;
  onSubmit: (payload: { email: string; password: string; name?: string }) => void;
}) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const isRegister = mode === 'register';

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({ email, password, name });
  };

  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="brand auth-brand">
          <div className="brand-mark">
            <BookOpen size={20} strokeWidth={2.6} />
          </div>
          <h1>EduVision</h1>
        </div>
        <h2>把试卷和学情数据，整理成老师真正用得上的判断。</h2>
        <p>登录后使用试卷 OCR、AI 分析和班级数据看板。学情 CSV / Excel 仍然在浏览器本地解析。</p>
        <div className="auth-feature-grid">
          <span>AI 试卷分析</span>
          <span>学情数据看板</span>
          <span>班级学生管理</span>
        </div>
      </section>
      <section className="auth-card">
        <div className="auth-tabs" aria-label="登录注册切换">
          <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => onModeChange('login')}>
            登录
          </button>
          <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => onModeChange('register')}>
            注册
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <header>
            <h2>{isRegister ? '创建教师账号' : '欢迎回来'}</h2>
            <p>{isRegister ? '注册后会自动进入工作台。' : '登录后继续使用 AI 分析能力。'}</p>
          </header>
          {isRegister && (
            <label className="field">
              <span>姓名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="张老师" autoComplete="name" />
            </label>
          )}
          <label className="field">
            <span>邮箱</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teacher@example.com" autoComplete="email" />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="spin" size={18} />}
            {isRegister ? '注册并进入' : '登录'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Sidebar({ activeModule, onNavigate }: { activeModule: ActiveModule; onNavigate: (module: ActiveModule) => void }) {
  const items: NavItem[] = [
    { id: 'dashboard', label: '学情看板', icon: LayoutDashboard },
    { id: 'exam', label: '试卷分析', icon: FileText },
    { id: 'grading', label: '智能阅卷', icon: ScanLine },
    { id: 'students', label: '学生管理', icon: Users },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <BookOpen size={20} strokeWidth={2.6} />
        </div>
        <h1>EduVision</h1>
      </div>
      <nav className="side-nav" aria-label="主导航">
        {items.map((item) => (
          <NavButton key={item.id} item={item} active={activeModule === item.id} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="side-footer">
        <NavButton item={{ id: 'settings', label: '系统设置', icon: Settings }} active={activeModule === 'settings'} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}

function NavButton({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: (module: ActiveModule) => void }) {
  return (
    <button className={active ? 'nav-button active' : 'nav-button'} type="button" onClick={() => onNavigate(item.id)}>
      <item.icon size={20} strokeWidth={active ? 2.6 : 2} />
      <span>{item.label}</span>
    </button>
  );
}

function Topbar({ user, onOpenSettings, onLogout }: { user: AuthUser; onOpenSettings: () => void; onLogout: () => void }) {
  return (
    <header className="topbar">
      <label className="global-search">
        <Search size={18} />
        <input placeholder="搜索试卷、学生或知识点..." />
      </label>
      <div className="topbar-actions">
        <button className="icon-button notification" type="button" aria-label="消息通知">
          <Bell size={20} />
        </button>
        <button className="teacher-card" type="button" onClick={onOpenSettings}>
          <span>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </span>
          <span className="avatar">
            <UserCircle size={24} strokeWidth={1.6} />
          </span>
        </button>
        <button className="logout-button" type="button" onClick={onLogout}>
          退出
        </button>
      </div>
    </header>
  );
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

function LearningDashboard({
  metrics,
  fileName,
  isLoading,
  onFileChange,
}: {
  metrics: DashboardMetrics | null;
  fileName: string;
  isLoading: boolean;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const source = metrics ?? fallbackMetrics;
  const isDemo = !metrics;
  const scoreDistribution = buildScoreDistribution(source.records);
  const weakKnowledge = source.weakKnowledge.slice(0, 5);
  const stats = [
    { label: '班级总人数', value: String(source.studentCount), unit: '人', icon: Users, tone: 'blue' },
    { label: '平均掌握率', value: Math.round(source.averageMastery).toString(), unit: '%', icon: TrendingUp, tone: 'green' },
    { label: '优秀率 (≥85)', value: getExcellentRate(source.records).toString(), unit: '%', icon: Target, tone: 'indigo' },
    { label: '待补漏知识点', value: weakKnowledge.length.toString(), unit: '个', icon: AlertCircle, tone: 'rose' },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="学情数据看板"
        description={isDemo ? '高二（3）班 - 数学期中考试综合分析（示例数据）' : `${fileName} - 已生成综合分析`}
        action={
          <label className="compact-upload">
            {isLoading ? <Loader2 className="spin" size={18} /> : <FileSpreadsheet size={18} />}
            <span>{fileName || '导入成绩表'}</span>
            <input type="file" accept=".xlsx,.csv" onChange={onFileChange} />
          </label>
        }
      />

      <section className="stats-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className={`stat-icon ${stat.tone}`}>
              <stat.icon size={26} strokeWidth={2.4} />
            </div>
            <div>
              <p>{stat.label}</p>
              <strong>
                {stat.value}
                <span>{stat.unit}</span>
              </strong>
            </div>
          </div>
        ))}
      </section>

      <section className="dashboard-grid">
        <Panel title="分数段分布">
          <ReactECharts option={makeScoreDistributionOption(scoreDistribution)} style={{ height: 280 }} />
        </Panel>
        <Panel title="班级平均分趋势">
          <ReactECharts option={makeTrendOption()} style={{ height: 280 }} />
        </Panel>
        <Panel title="知识点掌握雷达图">
          <ReactECharts option={makeRadarOption(source.weakKnowledge)} style={{ height: 300 }} />
        </Panel>
        <Panel title="薄弱知识点提醒">
          <div className="weak-list">
            {weakKnowledge.map((item, index) => (
              <div className="weak-item" key={item.name}>
                <div>
                  <span>{item.name}</span>
                  <strong>{Math.round(item.mastery)}%</strong>
                </div>
                <div className="progress-track">
                  <span className={index === 0 ? 'danger' : index < 3 ? 'warn' : 'ok'} style={{ width: `${Math.max(8, item.mastery)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="dashboard-grid bottom-grid">
        <Panel title="班级每题错误人数热力图" note="颜色越深，代表该班该题错误人数越多。">
          <ReactECharts option={makeHeatmapOption(source)} style={{ height: 320 }} />
        </Panel>
        <LearningImportHelp fileName={fileName} />
      </section>
    </div>
  );
}

function LearningImportHelp({ fileName }: { fileName: string }) {
  return (
    <Panel title="数据导入说明" note={fileName ? '当前文件已接入图表，可继续替换上传。' : '可直接使用仓库里的 sample-learning-data.csv 试跑。'}>
      <div className="import-help">
        <UploadCloud size={34} />
        <strong>支持 Excel / CSV 成绩明细</strong>
        <span>建议包含：班级、学生、题号、知识点、得分、满分。</span>
        <span>数据在浏览器本地解析，不上传学生明细。</span>
      </div>
    </Panel>
  );
}

function ExamAnalysis(props: {
  file: File | null;
  previewUrl: string;
  paperText: string;
  textSource: string;
  result: AnalysisResult | null;
  isExtractLoading: boolean;
  isAnalysisLoading: boolean;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onExtract: () => void;
  onAnalyze: () => void;
  onTextChange: (text: string) => void;
}) {
  const {
    file,
    previewUrl,
    paperText,
    textSource,
    result,
    isExtractLoading,
    isAnalysisLoading,
    onFileChange,
    onExtract,
    onAnalyze,
    onTextChange,
  } = props;
  const [customTag, setCustomTag] = React.useState('');
  const [manualTags, setManualTags] = React.useState<string[]>([]);
  const tags = React.useMemo(() => buildPaperTags(result, manualTags), [result, manualTags]);

  const addTag = () => {
    const normalized = normalizeTag(customTag);
    if (!normalized) return;
    setManualTags((current) => (current.includes(normalized) ? current : [...current, normalized]));
    setCustomTag('');
  };

  return (
    <div className="page-stack">
      <PageHeader title="试卷智能分析" description="上传试卷，AI 一键生成知识点覆盖、难度分布及讲评建议" />

      <section className="exam-layout">
        <div className="upload-card">
          <div className="upload-visual">
            {isExtractLoading ? <Sparkles className="spin-slow" size={48} /> : <FileText size={48} />}
          </div>
          <h3>{isExtractLoading ? 'AI 正在读取试卷...' : '点击或拖拽上传试卷'}</h3>
          <p>支持 PDF、DOCX、JPG、PNG。文本型 PDF 与 Word 会在浏览器本地读取，图片调用 OCR。</p>
          <label className="primary-label">
            <UploadCloud size={18} />
            <span>{file ? file.name : '选择文件并上传'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.docx" onChange={onFileChange} />
          </label>
          {previewUrl && <img className="preview" src={previewUrl} alt="试卷预览" />}
          <button className="secondary-action full" type="button" onClick={onExtract} disabled={isExtractLoading || !file}>
            {isExtractLoading ? <Loader2 className="spin" size={18} /> : <TextSearch size={18} />}
            {paperText ? '重新提取文本' : '提取试卷文本'}
          </button>
        </div>

        <Panel
          title="试卷文本"
          note={textSource ? `来源：${textSource}。可继续手动修正文档内容。` : '也可以直接粘贴试卷文本后生成分析。'}
          action={
            <button className="primary-action" type="button" onClick={onAnalyze} disabled={isAnalysisLoading || !paperText.trim()}>
              {isAnalysisLoading ? <Loader2 className="spin" size={16} /> : <BrainCircuit size={16} />}
              {isAnalysisLoading ? '分析中' : '生成分析'}
            </button>
          }
        >
          <textarea
            className="ocr-editor"
            placeholder="提取出的试卷文本会显示在这里。也可以直接粘贴试卷文本，再点击生成分析。"
            value={paperText}
            onChange={(event) => onTextChange(event.target.value)}
          />
        </Panel>
      </section>

      {!result ? (
        <section className="empty-analysis">
          <BrainCircuit size={44} />
          <h3>等待试卷分析</h3>
          <p>生成后会展示知识点覆盖、难度分布、题型结构、讲评重点和试卷标签。</p>
        </section>
      ) : (
        <section className="analysis-results">
          <div className="success-banner">
            <CheckCircle2 size={28} />
            <div>
              <h3>分析完成：{file?.name || '试卷文本'}</h3>
              <p>{result.summary}</p>
            </div>
          </div>
          <div className="dashboard-grid three">
            <Panel title="知识点覆盖率">
              <ReactECharts option={makeKnowledgePieOption(result)} style={{ height: 250 }} />
            </Panel>
            <Panel title="难度阶梯分布">
              <ReactECharts option={makeDifficultyOption(result)} style={{ height: 250 }} />
            </Panel>
            <Panel title="智能讲评建议" className="suggestion-panel">
              <div className="suggestion-list">
                {(result.lectureSuggestions.length ? result.lectureSuggestions : ['聚焦错误率最高的综合题，先拆解关键步骤。']).slice(0, 3).map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            </Panel>
          </div>
          <Panel
            title="题目标签系统"
            note="用于沉淀试卷特征，后续可按标签筛选讲评策略和题库资源。"
            action={
              <div className="tag-input">
                <input value={customTag} placeholder="#自定义标签" onChange={(event) => setCustomTag(event.target.value)} />
                <button type="button" onClick={addTag} aria-label="添加标签">
                  <Plus size={16} />
                </button>
              </div>
            }
          >
            <div className="tag-row">
              {tags.map((tag) => (
                <span className="pill" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </Panel>
        </section>
      )}
    </div>
  );
}

function SmartGrading() {
  const tools = [
    { title: '试卷自动批改', desc: '扫描或拍照上传，AI 秒级阅卷并生成分析', icon: Scan, tone: 'blue' },
    { title: '错题归纳', desc: '自动提取试卷错题，生成班级共性错题本', icon: BookOpen, tone: 'rose' },
    { title: '作文批改', desc: '智能分析立意结构，提供润色建议与范文', icon: PenTool, tone: 'green' },
    { title: '智能听写', desc: '自动播报词汇，拍照批改听写结果', icon: Mic, tone: 'amber' },
    { title: '拍照搜题', desc: '遇到疑难杂题，一键搜索解析与同类题', icon: ImageIcon, tone: 'indigo' },
    { title: '口算批改', desc: '批量识别基础计算题，快速核对答案', icon: BrainCircuit, tone: 'cyan' },
  ];

  return (
    <div className="page-stack">
      <PageHeader title="智能阅卷与工具箱" description="利用 AI 提升教学效率，释放批改时间" />
      <section className="grading-hero">
        <div>
          <span className="hero-chip">
            <Sparkles size={14} />
            全新升级 AI 批改引擎
          </span>
          <h3>一键扫描，即刻出分</h3>
          <p>支持整班试卷批量上传或高拍仪实时扫描。系统自动识别手写笔迹、客观题填涂及主观题步骤。</p>
          <div className="hero-actions">
            <button type="button">去上传试卷</button>
            <button type="button" className="ghost">
              连接高拍仪
            </button>
          </div>
        </div>
        <div className="scan-orb">
          <Scan size={80} />
        </div>
      </section>
      <h3 className="section-title">效率工具集</h3>
      <section className="tool-grid">
        {tools.map((tool) => (
          <article className="tool-card" key={tool.title}>
            <div className={`tool-icon ${tool.tone}`}>
              <tool.icon size={26} strokeWidth={2.4} />
            </div>
            <h4>{tool.title}</h4>
            <p>{tool.desc}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function StudentManagement({ metrics }: { metrics: DashboardMetrics }) {
  const [searchTerm, setSearchTerm] = React.useState('');
  const students = React.useMemo(() => buildStudentRows(metrics.records), [metrics.records]);
  const filtered = students.filter((student) => student.name.includes(searchTerm) || student.id.includes(searchTerm));

  return (
    <div className="page-stack">
      <PageHeader
        title="班级学生管理"
        description={`${metrics.classes[0] || '高二（3）班'} - 共 ${students.length} 人`}
        action={
          <div className="button-row">
            <button className="secondary-action" type="button">
              <Filter size={18} />
              筛选
            </button>
            <button className="primary-action" type="button">
              <UserPlus size={18} />
              添加学生
            </button>
          </div>
        }
      />
      <label className="student-search">
        <Search size={20} />
        <input placeholder="搜索学生姓名或学号..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
      </label>
      <section className="student-table-card">
        <table>
          <thead>
            <tr>
              <th>基本信息</th>
              <th>学号</th>
              <th>家长联系方式</th>
              <th>近期均分</th>
              <th>趋势</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((student, index) => (
              <tr key={student.id}>
                <td>
                  <div className="student-info">
                    <span className={index % 2 === 0 ? 'student-avatar male' : 'student-avatar female'}>{student.name.charAt(0)}</span>
                    <span>
                      <strong>{student.name}</strong>
                      <small>{index % 2 === 0 ? '男' : '女'}</small>
                    </span>
                  </div>
                </td>
                <td className="mono">{student.id}</td>
                <td>
                  <span className="phone-cell">
                    <Phone size={14} />
                    138****{String(index + 1).padStart(4, '0')}
                  </span>
                </td>
                <td>
                  <span className={`score-pill ${student.score >= 85 ? 'excellent' : student.score < 70 ? 'warning' : 'good'}`}>{student.score}</span>
                </td>
                <td>{student.trend === 'up' ? <TrendingUp className="trend-up" size={18} /> : student.trend === 'down' ? <TrendingDown className="trend-down" size={18} /> : <Mail className="trend-flat" size={18} />}</td>
                <td>
                  <button className="table-action" type="button" aria-label="更多操作">
                    <MoreHorizontal size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="table-empty">没有找到匹配的学生</div>}
      </section>
    </div>
  );
}

function SettingsPage() {
  const [activeTab, setActiveTab] = React.useState<'profile' | 'notifications' | 'security'>('profile');
  const tabs = [
    { id: 'profile', label: '个人信息', icon: User },
    { id: 'notifications', label: '消息通知', icon: Bell },
    { id: 'security', label: '账号安全', icon: Shield },
  ] as const;

  return (
    <div className="page-stack settings-page">
      <PageHeader title="系统设置" description="管理您的个人资料、偏好设置和账户安全" />
      <section className="settings-layout">
        <nav className="settings-tabs">
          {tabs.map((tab) => (
            <button className={activeTab === tab.id ? 'active' : ''} key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}>
              <tab.icon size={20} />
              {tab.label}
            </button>
          ))}
        </nav>
        <Panel title={tabs.find((tab) => tab.id === activeTab)?.label || '设置'} className="settings-panel">
          {activeTab === 'profile' && (
            <div className="profile-form">
              <div className="profile-head">
                <div className="profile-avatar">张</div>
                <div>
                  <h3>张老师</h3>
                  <p>高二数学教研组组长</p>
                  <div className="button-row">
                    <button className="secondary-action" type="button">
                      更换头像
                    </button>
                    <button className="secondary-action muted" type="button">
                      删除
                    </button>
                  </div>
                </div>
              </div>
              <div className="form-grid">
                <LabeledInput label="姓名" defaultValue="张老师" />
                <LabeledInput label="工号" defaultValue="T2021008" disabled />
                <LabeledInput label="联系电话" defaultValue="138 0000 0000" />
                <LabeledInput label="任教班级" defaultValue="高二（3）班, 高二（4）班" />
              </div>
              <button className="primary-action align-right" type="button">
                <Save size={18} />
                保存修改
              </button>
            </div>
          )}
          {activeTab === 'notifications' && (
            <div className="setting-list">
              {[
                ['成绩分析报告生成提醒', '当系统完成试卷批改和分析时发送通知', true],
                ['学生成绩异动预警', '当学生成绩出现大幅下滑时及时提醒', true],
                ['班级周报/月报推送', '每周/每月自动生成并推送班级学情总结', false],
                ['系统更新与维护通知', '平台功能上新或系统维护的系统消息', true],
              ].map(([title, desc, checked]) => (
                <label className="switch-row" key={String(title)}>
                  <span>
                    <strong>{title}</strong>
                    <small>{desc}</small>
                  </span>
                  <input type="checkbox" defaultChecked={Boolean(checked)} />
                </label>
              ))}
            </div>
          )}
          {activeTab === 'security' && (
            <div className="setting-list">
              <SecurityRow icon={Shield} title="登录密码" desc="建议定期更换密码以保障账号安全" action="修改" />
              <SecurityRow icon={Smartphone} title="手机绑定" desc="已绑定：138 **** 0000" action="更换" />
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

function Panel({
  title,
  note,
  action,
  children,
  className = '',
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          {note && <p>{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function LabeledInput({ label, defaultValue, disabled = false }: { label: string; defaultValue: string; disabled?: boolean }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input defaultValue={defaultValue} disabled={disabled} />
    </label>
  );
}

function SecurityRow({
  icon: Icon,
  title,
  desc,
  action,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  desc: string;
  action: string;
}) {
  return (
    <div className="security-row">
      <div>
        <span className="security-icon">
          <Icon size={20} />
        </span>
        <span>
          <strong>{title}</strong>
          <small>{desc}</small>
        </span>
      </div>
      <button className="secondary-action" type="button">
        {action}
      </button>
    </div>
  );
}

function makeScoreDistributionOption(data: Array<{ range: string; count: number }>) {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 34, right: 16, top: 16, bottom: 32 },
    xAxis: { type: 'category', data: data.map((item) => item.range), axisTick: { show: false }, axisLine: { show: false } },
    yAxis: { type: 'value', axisTick: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: '#eef2f7' } } },
    series: [{ name: '人数', type: 'bar', barWidth: 36, itemStyle: { color: '#3b82f6', borderRadius: 6 }, data: data.map((item) => item.count) }],
  };
}

function makeTrendOption() {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 34, right: 18, top: 20, bottom: 32 },
    xAxis: { type: 'category', boundaryGap: false, data: ['第一周', '第二周', '第三周', '第四周', '第五周'], axisTick: { show: false }, axisLine: { show: false } },
    yAxis: { type: 'value', min: 60, max: 90, axisLine: { show: false }, splitLine: { lineStyle: { color: '#eef2f7' } } },
    series: [
      {
        name: '平均分',
        type: 'line',
        smooth: true,
        symbolSize: 8,
        lineStyle: { color: '#6366f1', width: 4 },
        areaStyle: { color: 'rgba(99, 102, 241, 0.14)' },
        data: [72, 75, 71, 78, 82],
      },
    ],
  };
}

function makeRadarOption(metrics: Metric[]) {
  const source = metrics.slice(0, 5);
  const data = source.length ? source : fallbackMetrics.weakKnowledge.slice(0, 5);
  return {
    tooltip: {},
    radar: {
      radius: '68%',
      indicator: data.map((item) => ({ name: item.name, max: 100 })),
      splitLine: { lineStyle: { color: '#e2e8f0' } },
      splitArea: { areaStyle: { color: ['#ffffff', '#f8fafc'] } },
    },
    series: [{ type: 'radar', data: [{ value: data.map((item) => Math.round(item.mastery)), name: '掌握率' }], areaStyle: { color: 'rgba(14, 165, 233, 0.16)' }, lineStyle: { color: '#0ea5e9', width: 3 } }],
  };
}

function makeHeatmapOption(metrics: DashboardMetrics) {
  return {
    tooltip: {
      formatter: (params: { data: [number, number, number, string] }) => {
        const [x, y, value, kp] = params.data;
        return `${metrics.classes[y]}<br/>${metrics.questions[x]} - ${kp}<br/>错误人数：${value}`;
      },
    },
    grid: { left: 82, right: 24, top: 24, bottom: 48 },
    xAxis: { type: 'category', data: metrics.questions, splitArea: { show: true }, axisTick: { show: false } },
    yAxis: { type: 'category', data: metrics.classes, splitArea: { show: true }, axisTick: { show: false } },
    visualMap: {
      min: 0,
      max: Math.max(1, ...metrics.heatmap.map((item) => item.wrongCount)),
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: ['#eff6ff', '#93c5fd', '#3b82f6', '#ef4444'] },
    },
    series: [
      {
        name: '错误人数',
        type: 'heatmap',
        label: { show: true },
        data: metrics.heatmap.map((item) => [
          metrics.questions.indexOf(item.questionId),
          metrics.classes.indexOf(item.className),
          item.wrongCount,
          item.knowledgePoint,
        ]),
      },
    ],
  };
}

function makeKnowledgePieOption(result: AnalysisResult) {
  const data = result.knowledgeCoverage.map((item) => ({ value: item.count, name: item.name }));
  return {
    tooltip: { trigger: 'item' },
    legend: {
      type: 'scroll',
      bottom: 0,
      left: 0,
      right: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#475569', fontSize: 12 },
    },
    color: ['#3b82f6', '#8b5cf6', '#0ea5e9', '#10b981', '#cbd5e1'],
    series: [
      {
        type: 'pie',
        radius: ['42%', '62%'],
        center: ['50%', '42%'],
        padAngle: 4,
        avoidLabelOverlap: true,
        label: { formatter: '{d}%', color: '#334155', fontSize: 12 },
        labelLine: { length: 12, length2: 8 },
        data,
      },
    ],
  };
}

function makeDifficultyOption(result: AnalysisResult) {
  const data = [
    { value: result.difficultyDistribution.easy, name: '基础题' },
    { value: result.difficultyDistribution.medium, name: '中等题' },
    { value: result.difficultyDistribution.hard, name: '难题' },
  ];
  return {
    tooltip: { trigger: 'item' },
    legend: {
      bottom: 0,
      left: 'center',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#475569', fontSize: 12 },
    },
    color: ['#10b981', '#f59e0b', '#ef4444'],
    series: [
      {
        type: 'pie',
        radius: ['42%', '64%'],
        center: ['50%', '42%'],
        startAngle: 180,
        avoidLabelOverlap: true,
        label: { formatter: '{b}: {c}', color: '#334155', fontSize: 12 },
        labelLine: { length: 12, length2: 8 },
        data,
      },
    ],
  };
}

function buildScoreDistribution(records: LearningRecord[]) {
  const totals = Array.from(groupByStudent(records).values()).map((items) => Math.round(safeRate(sum(items, 'score'), sum(items, 'fullScore'))));
  const ranges = [
    { range: '0-59', min: 0, max: 59 },
    { range: '60-69', min: 60, max: 69 },
    { range: '70-79', min: 70, max: 79 },
    { range: '80-89', min: 80, max: 89 },
    { range: '90-100', min: 90, max: 100 },
  ];
  return ranges.map((range) => ({ range: range.range, count: totals.filter((score) => score >= range.min && score <= range.max).length }));
}

function getExcellentRate(records: LearningRecord[]): number {
  const totals = Array.from(groupByStudent(records).values()).map((items) => safeRate(sum(items, 'score'), sum(items, 'fullScore')));
  if (!totals.length) return 0;
  return Math.round((totals.filter((score) => score >= 85).length / totals.length) * 100);
}

function groupByStudent(records: LearningRecord[]): Map<string, LearningRecord[]> {
  const map = new Map<string, LearningRecord[]>();
  for (const record of records) {
    const key = `${record.className}-${record.studentName}`;
    map.set(key, [...(map.get(key) ?? []), record]);
  }
  return map;
}

function sum(records: LearningRecord[], key: 'score' | 'fullScore'): number {
  return records.reduce((total, record) => total + record[key], 0);
}

function buildStudentRows(records: LearningRecord[]) {
  return Array.from(groupByStudent(records), ([key, items], index) => {
    const [, nameFromKey] = key.split('-');
    const score = Math.round(safeRate(sum(items, 'score'), sum(items, 'fullScore')));
    return {
      id: `2023${String(index + 1).padStart(4, '0')}`,
      name: items[0]?.studentName || nameFromKey || '未命名',
      score,
      trend: score >= 84 ? 'up' : score < 70 ? 'down' : 'same',
    };
  });
}

async function readLearningRecords(file: File): Promise<LearningRecord[]> {
  const rows = file.name.toLowerCase().endsWith('.csv') ? parseCsvRows(await file.text()) : await parseXlsxRows(file);
  const records = rows.map(normalizeLearningRecord).filter((record): record is LearningRecord => Boolean(record));
  if (records.length === 0) throw new Error('没有识别到有效成绩明细。请确认表格包含班级、学生、知识点、得分、满分等列。');
  return records;
}

async function parseXlsxRows(file: File): Promise<Array<Record<string, unknown>>> {
  return matrixToObjects((await readSheet(file)) as unknown[][]);
}

function parseCsvRows(text: string): Array<Record<string, unknown>> {
  return matrixToObjects(parseCsv(text));
}

function matrixToObjects(rows: unknown[][]): Array<Record<string, unknown>> {
  const [headers = [], ...dataRows] = rows;
  const normalizedHeaders = headers.map((header) => String(header ?? '').trim());
  return dataRows
    .filter((row) => row.some((cell) => String(cell ?? '').trim()))
    .map((row) => {
      const record: Record<string, unknown> = {};
      normalizedHeaders.forEach((header, index) => {
        if (header) record[header] = row[index] ?? '';
      });
      return record;
    });
}

function normalizeLearningRecord(row: Record<string, unknown>): LearningRecord | null {
  const className = pickString(row, ['班级', '班别', '年级班级', 'class', 'Class']) || '未分班';
  const studentName = pickString(row, ['学生', '学生姓名', '姓名', 'student', 'name']) || '未命名';
  const questionId = pickString(row, ['题号', '小题', '题目', 'question', 'Question']) || '未标题号';
  const knowledgePoint = pickString(row, ['知识点', '考点', '章节', '能力点', 'knowledge', 'Knowledge']) || '未标知识点';
  const score = pickNumber(row, ['得分', '分数', '实际得分', 'score', 'Score']);
  const fullScore = pickNumber(row, ['满分', '总分', '题目满分', 'fullScore', 'FullScore', 'Full Score']);
  return score === null || fullScore === null || fullScore <= 0 ? null : { className, studentName, questionId, knowledgePoint, score, fullScore };
}

function buildDashboardMetrics(records: LearningRecord[]): DashboardMetrics {
  const classSet = new Set(records.map((record) => record.className));
  const studentSet = new Set(records.map((record) => `${record.className}-${record.studentName}`));
  const totalScore = records.reduce((total, record) => total + record.score, 0);
  const totalFullScore = records.reduce((total, record) => total + record.fullScore, 0);
  const classes = Array.from(classSet).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const questions = Array.from(new Set(records.map((record) => record.questionId))).sort(sortQuestionId);
  return {
    records,
    classCount: classSet.size,
    studentCount: studentSet.size,
    averageMastery: safeRate(totalScore, totalFullScore),
    weakKnowledge: aggregateMetrics(records, (record) => record.knowledgePoint).sort((a, b) => a.mastery - b.mastery),
    classMetrics: aggregateClassMetrics(records).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')),
    questionWeakness: aggregateMetrics(records, (record) => `${record.questionId} - ${record.knowledgePoint}`).sort((a, b) => a.mastery - b.mastery),
    heatmap: buildHeatmap(records, classes, questions),
    classes,
    questions,
  };
}

function buildHeatmap(records: LearningRecord[], classes: string[], questions: string[]): HeatCell[] {
  return classes.flatMap((className) =>
    questions.map((questionId) => {
      const target = records.filter((record) => record.className === className && record.questionId === questionId);
      return {
        className,
        questionId,
        wrongCount: target.filter((record) => record.score < record.fullScore).length,
        knowledgePoint: target[0]?.knowledgePoint || '未标知识点',
      };
    }),
  );
}

function aggregateMetrics(records: LearningRecord[], keyGetter: (record: LearningRecord) => string): Metric[] {
  const map = new Map<string, { score: number; fullScore: number; records: number }>();
  for (const record of records) {
    const key = keyGetter(record);
    const current = map.get(key) ?? { score: 0, fullScore: 0, records: 0 };
    current.score += record.score;
    current.fullScore += record.fullScore;
    current.records += 1;
    map.set(key, current);
  }
  return Array.from(map, ([name, value]) => ({ name, ...value, mastery: safeRate(value.score, value.fullScore) }));
}

function aggregateClassMetrics(records: LearningRecord[]): ClassMetric[] {
  return aggregateMetrics(records, (record) => record.className).map((item) => ({
    ...item,
    students: new Set(records.filter((record) => record.className === item.name).map((record) => record.studentName)).size,
  }));
}

function buildPaperTags(result: AnalysisResult | null, manualTags: string[]): string[] {
  if (!result) return manualTags;
  const tags = new Set<string>(manualTags);
  for (const item of result.knowledgeCoverage.slice(0, 6)) tags.add(normalizeTag(item.name));
  const joined = [...result.weakPoints, ...result.lectureSuggestions, result.summary].join(' ');
  if (/陷阱|易错|审题|混淆/.test(joined)) tags.add('#陷阱题');
  if (/创新|情境|开放|迁移/.test(joined)) tags.add('#创新题');
  if (/计算|运算|步骤/.test(joined)) tags.add('#计算量大');
  if (/压轴|综合|较难|拔高/.test(joined)) tags.add('#综合压轴');
  if (result.difficultyDistribution.hard > result.difficultyDistribution.easy) tags.add('#难度偏高');
  return Array.from(tags).filter(Boolean);
}

function normalizeTag(value: string): string {
  const trimmed = value.trim().replace(/^#+/, '');
  return trimmed ? `#${trimmed}` : '';
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    const parsed = typeof value === 'number' ? value : Number(String(value).replace('%', '').trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  rows.push(row);
  return rows.filter((currentRow) => currentRow.some((value) => value));
}

function safeRate(score: number, fullScore: number): number {
  return fullScore > 0 ? (score / fullScore) * 100 : 0;
}

function sortQuestionId(a: string, b: string): number {
  const aNumber = Number(a.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  const bNumber = Number(b.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  return aNumber === bNumber ? a.localeCompare(b, 'zh-Hans-CN') : aNumber - bNumber;
}

function getFileKind(file: File): 'image' | 'pdf' | 'docx' | 'unknown' {
  const name = file.name.toLowerCase();
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) return 'docx';
  return 'unknown';
}

async function recognizeImage(imageFile: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', imageFile);
  const response = await fetch(`${API_BASE_URL}/api/ocr`, { method: 'POST', credentials: 'include', body: formData });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || '图片 OCR 识别失败，请稍后重试。');
  return (payload as OcrResponse).text;
}

async function extractPdfText(file: File): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim();
    pageTexts.push(`第 ${pageNumber} 页\n${text}`);
  }
  const merged = pageTexts.join('\n\n').trim();
  if (merged.length < 20) throw new Error('这个 PDF 没有可直接读取的文本，可能是扫描版。请先转成图片上传。');
  return merged;
}

async function extractDocxText(file: File): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const text = result.value.replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 20) throw new Error('这个 Word 文件没有读取到有效文本，请检查文件内容。');
  return text;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
