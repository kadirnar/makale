import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  ArrowUpRight,
  ArrowRight,
  FileText,
  Link,
  Upload,
  X,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  Check,
  ShieldCheck,
  Languages,
  Sparkles,
  NotebookPen,
  Download,
  Trash2,
  Lock,
  PanelLeftClose,
  Library,
  RefreshCw,
  LoaderCircle,
  PenLine,
  CheckCheck,
  AlertCircle,
} from "lucide-react";
import type { Article, Initial, Model, Progress, Settings } from "./types";
import { messages, errors } from "./i18n";
import { renderArticle, renderMarkdown } from "./render";
import { sample } from "./sample";
import PdfView from "./PdfView";
const api = <T,>(name: string, args?: unknown) =>
  window.makale.call<T>(name, args);
export default function App() {
  const [articles, setArticles] = useState<Article[]>([]),
    [activeId, setActiveId] = useState(""),
    [settings, setSettings] = useState<Settings>({
      language: "tr",
      theme: "system",
      model: "",
      terms: [],
    });
  const [initialized, setInitialized] = useState(false),
    [keyConfigured, setKeyConfigured] = useState(false),
    [keySecure, setKeySecure] = useState(false),
    [defaultTerms, setDefaultTerms] = useState<string[]>([]);
  const [tab, setTab] = useState<"reader" | "report" | "writing">("reader"),
    [modal, setModal] = useState<"import" | "settings" | "models" | null>(null),
    [search, setSearch] = useState(""),
    [modelSearch, setModelSearch] = useState(""),
    [models, setModels] = useState<Model[]>([]),
    [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState(""),
    [importBusy, setImportBusy] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<Progress>(),
    [selection, setSelection] = useState<string[]>([]),
    [pdfMode, setPdfMode] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [blogPreview, setBlogPreview] = useState(false);
  const [importMode, setImportMode] = useState<"url" | "paste">("url"),
    [url, setUrl] = useState(""),
    [pasteTitle, setPasteTitle] = useState(""),
    [pasteText, setPasteText] = useState(""),
    [keyInput, setKeyInput] = useState(""),
    [saveStatus, setSaveStatus] = useState("saved");
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const isDark =
    settings.theme === "dark" || (settings.theme === "system" && systemDark);
  const pending = useRef<Record<string, Partial<Article>>>({}),
    saveQueue = useRef(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    sourceRef = useRef<HTMLDivElement>(null),
    targetRef = useRef<HTMLDivElement>(null),
    syncing = useRef(false);
  const t = messages[settings.language],
    article = articles.find((a) => a.id === activeId),
    chosen = models.find((m) => m.id === settings.model);
  const fail = useCallback(
    (e: unknown) => {
      const raw = e instanceof Error ? e.message : String(e);
      const code = Object.keys(errors).find((k) => raw.includes(k));
      setError(
        code
          ? errors[code][settings.language === "en" ? 0 : 1]
          : raw.replace(/Error invoking remote method '[^']+': Error: /, ""),
      );
    },
    [settings.language],
  );
  const replace = (a: Article) =>
    setArticles((all) =>
      all.map((x) => (x.id === a.id ? { ...a, ...pending.current[a.id] } : x)),
    );
  useEffect(() => {
    api<Initial>("init")
      .then((data) => {
        setArticles(data.articles);
        setActiveId(data.articles[0]?.id || "");
        setSettings(data.settings);
        setKeyConfigured(data.keyConfigured);
        setKeySecure(data.keySecure);
        setDefaultTerms(data.defaultTerms);
        setInitialized(true);
      })
      .catch(fail);
  }, []);
  useEffect(
    () =>
      window.makale.onProgress((p) => {
        setProgress(p);
        if (p.article) replace(p.article);
      }),
    [],
  );
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      setSystemDark(query.matches);
      document.documentElement.dataset.theme =
        settings.theme === "system"
          ? query.matches
            ? "dark"
            : "light"
          : settings.theme;
    };
    apply();
    query.addEventListener("change", apply);
    document.documentElement.lang = settings.language;
    return () => query.removeEventListener("change", apply);
  }, [settings.theme, settings.language]);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const patches = Object.fromEntries(
      Object.entries(pending.current).map(([id, patch]) => [id, { ...patch }]),
    );
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(async () => {
        for (const [id, patch] of Object.entries(patches))
          try {
            await api("edit", { id, ...patch });
            for (const key of Object.keys(patch) as (keyof Article)[]) {
              if (pending.current[id]?.[key] === patch[key])
                delete pending.current[id][key];
            }
            if (pending.current[id] && !Object.keys(pending.current[id]).length)
              delete pending.current[id];
          } catch (e) {
            pending.current[id] = { ...patch, ...pending.current[id] };
            setSaveStatus("unsaved");
            throw e;
          }
        setSaveStatus(Object.keys(pending.current).length ? "saving" : "saved");
      });
    return saveQueue.current;
  }, []);
  useEffect(() => {
    const closing = (event: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length || saveStatus === "saving") {
        event.preventDefault();
        event.returnValue = false;
        void flush()
          .then(() => window.close())
          .catch(fail);
      }
    };
    window.addEventListener("beforeunload", closing);
    return () => window.removeEventListener("beforeunload", closing);
  }, [flush, saveStatus, fail]);
  function updateDraft(field: "notes" | "blog", value: string) {
    if (!article) return;
    const patch = { [field]: value };
    pending.current[article.id] = { ...pending.current[article.id], ...patch };
    setArticles((all) =>
      all.map((a) => (a.id === article.id ? { ...a, ...patch } : a)),
    );
    setSaveStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(fail), 450);
  }
  async function changeSettings(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      await api("settings", next);
    } catch (e) {
      fail(e);
    }
  }
  async function openModels() {
    setModal("models");
    if (!models.length) await loadModels();
  }
  async function loadModels() {
    setLoadingModels(true);
    try {
      setModels(await api<Model[]>("models"));
    } catch (e) {
      fail(e);
    } finally {
      setLoadingModels(false);
    }
  }
  async function imported(action: () => Promise<Article | null>) {
    setImportBusy(true);
    setError("");
    try {
      const a = await action();
      if (a) {
        await flush();
        setArticles((all) => [a, ...all]);
        setActiveId(a.id);
        setTab("reader");
        setSelection([]);
        setPdfMode(a.kind === "pdf");
        setModal(null);
        setUrl("");
        setPasteText("");
      }
    } catch (e) {
      fail(e);
    } finally {
      setImportBusy(false);
    }
  }
  async function chooseArticle(a: Article) {
    try {
      await flush();
      setActiveId(a.id);
      setSelection([]);
      setPdfMode(a.kind === "pdf");
      setTab("reader");
    } catch (e) {
      fail(e);
    }
  }
  const done =
      article?.units.filter(
        (u) => article.translations[u.id] || article.locked.includes(u.id),
      ).length || 0,
    total = article?.units.length || 0,
    complete = total > 0 && done === total;
  async function run(kind: "translate" | "report" | "blog", ids?: string[]) {
    if (!article) return;
    if (!keyConfigured) {
      setModal("settings");
      return;
    }
    if (!settings.model) {
      void openModels();
      return;
    }
    if (kind === "blog" && article.blog && !confirm(t.blogConfirm)) return;
    if (kind === "report" && article.report && !confirm(t.reportConfirm))
      return;
    setError("");
    setBusy(true);
    setProgress({
      id: article.id,
      stage: kind === "translate" ? "translation" : kind,
      done: 0,
      total: 1,
    });
    try {
      await flush();
      replace(await api<Article>("run", { id: article.id, kind, ids }));
      setSelection([]);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }
  async function editArticle(patch: Partial<Article>) {
    if (!article) return;
    const before = article;
    setArticles((all) =>
      all.map((a) => (a.id === article.id ? { ...a, ...patch } : a)),
    );
    try {
      replace(await api<Article>("edit", { id: article.id, ...patch }));
    } catch (e) {
      replace(before);
      fail(e);
    }
  }
  async function exportFile(kind: string) {
    if (!article) return;
    try {
      await flush();
      await api("export", { id: article.id, kind });
    } catch (e) {
      fail(e);
    }
  }
  function selectPassage() {
    const selected = window.getSelection();
    if (
      !selected ||
      selected.isCollapsed ||
      !sourceRef.current?.contains(selected.anchorNode)
    )
      return;
    const range = selected.getRangeAt(0);
    setSelection(
      Array.from(sourceRef.current.querySelectorAll("[data-unit]"))
        .filter((el) => range.intersectsNode(el))
        .map((el) => el.getAttribute("data-unit")!),
    );
  }
  function scrollSync(from: "source" | "target") {
    if (syncing.current || pdfMode) return;
    const a = from === "source" ? sourceRef.current : targetRef.current,
      b = from === "source" ? targetRef.current : sourceRef.current;
    if (!a || !b) return;
    syncing.current = true;
    const elements = Array.from(a.querySelectorAll<HTMLElement>("[data-unit]"));
    const base = a.getBoundingClientRect().top;
    const visible = elements.find(
      (el) => el.getBoundingClientRect().bottom > base + 12,
    );
    const match =
      visible &&
      b.querySelector<HTMLElement>(`[data-unit="${visible.dataset.unit}"]`);
    if (visible && match)
      b.scrollTop +=
        match.getBoundingClientRect().top -
        b.getBoundingClientRect().top -
        (visible.getBoundingClientRect().top - base);
    requestAnimationFrame(() => (syncing.current = false));
  }
  const sourceHtml = useMemo(
      () => (article ? renderArticle(article) : ""),
      [article],
    ),
    targetHtml = useMemo(
      () => (article ? renderArticle(article, true) : ""),
      [article],
    );
  function evidenceClick(event: React.MouseEvent) {
    const target = event.target as HTMLElement;
    const match = target
      .closest("[data-evidence]")
      ?.getAttribute("data-evidence");
    if (match) {
      setTab("reader");
      setPdfMode(false);
      setTimeout(() => {
        const element = sourceRef.current?.querySelector(
          `[data-unit="${match}"], [data-evidence="${match}"]`,
        );
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
        element?.classList.add("highlighted");
        setTimeout(() => element?.classList.remove("highlighted"), 2500);
      }, 100);
    }
  }
  const reportHtml = useMemo(
    () =>
      article
        ? renderMarkdown(article.report).replace(
            /\[((?:[up]\d+)(?:\s*[,;]\s*[up]\d+)*)\]/g,
            (_match, refs: string) =>
              refs
                .split(/\s*[,;]\s*/)
                .map(
                  (id) =>
                    `<button class="evidence-link" data-evidence="${id}">[${id}]</button>`,
                )
                .join(" "),
          )
        : "",
    [article?.report],
  );
  if (!initialized)
    return (
      <div className="boot">
        <div className="brand-mark">
          m<span>•</span>
        </div>
        {error || <LoaderCircle className="spin" />}
      </div>
    );
  return (
    <div className={`app ${sidebar ? "" : "sidebar-hidden"}`}>
      <aside className="sidebar">
        <a
          className="brand"
          onClick={() => {
            setActiveId("");
            setTab("reader");
          }}
        >
          <div className="brand-mark">
            m<span>•</span>
          </div>
          <div>
            makale<small>{t.reading}</small>
          </div>
        </a>
        <button
          className="button primary add-button"
          onClick={() => setModal("import")}
        >
          <Plus size={17} />
          {t.newArticle}
          <span className="keycap">+</span>
        </button>
        <div className="side-label">{t.workspace}</div>
        <button className="side-nav active" onClick={() => setActiveId("")}>
          <Library size={18} />
          {t.allArticles}
          <span>{articles.length}</span>
        </button>
        <div className="side-label library-label">{t.library}</div>
        <div className="search-box">
          <Search size={15} />
          <input
            aria-label={t.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
          />
        </div>
        <div className="article-list">
          {articles
            .filter((a) =>
              a.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
            )
            .map((a) => (
              <button
                key={a.id}
                className={`article-item ${a.id === activeId ? "selected" : ""}`}
                onClick={() => void chooseArticle(a)}
              >
                <FileText size={17} />
                <div>
                  <strong>{a.title}</strong>
                  <small>
                    {new Date(a.createdAt).toLocaleDateString(
                      settings.language === "tr" ? "tr-TR" : "en-US",
                      { month: "short", day: "numeric" },
                    )}
                    <span>·</span>
                    {a.kind.toUpperCase()}
                  </small>
                </div>
                {Object.keys(a.translations).length > 0 && (
                  <span className="article-dot" />
                )}
              </button>
            ))}
          {!articles.length && (
            <div className="library-empty">
              <BookOpen size={25} />
              <p>{t.emptyLibrary}</p>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span />
            {t.autoSave}
          </div>
          <button className="side-nav" onClick={() => setModal("settings")}>
            <SettingsIcon size={18} />
            {t.settings}
            <span>
              <ChevronDown size={14} />
            </span>
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button"
              aria-label="Toggle sidebar"
              onClick={() => setSidebar(!sidebar)}
            >
              <PanelLeftClose size={18} />
            </button>
            <span>{t.library}</span>
            {article && (
              <>
                <span className="slash">/</span>
                <strong>{article.title}</strong>
              </>
            )}
          </div>
          <div className="top-actions">
            <button
              className="language-button"
              onClick={() =>
                void changeSettings({
                  language: settings.language === "tr" ? "en" : "tr",
                })
              }
            >
              <Languages size={15} />
              {settings.language.toUpperCase()}
            </button>
            <button
              className="icon-button"
              aria-label={t.theme}
              onClick={() =>
                void changeSettings({
                  theme: isDark ? "light" : "dark",
                })
              }
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        {error && !modal && (
          <div role="alert" className="error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label={t.dismiss}
              onClick={() => setError("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {!article ? (
          <div className="welcome">
            <div className="eyebrow">
              <span />
              {t.learn}
            </div>
            <h1>{t.welcome}</h1>
            <p className="welcome-description">{t.welcomeSub}</p>
            <div className="import-card">
              <div className="import-icon">
                <BookOpen size={30} />
              </div>
              <h2>{t.importTitle}</h2>
              <p>{t.importSub}</p>
              <div className="import-options">
                <button onClick={() => void imported(() => api("upload"))}>
                  <Upload size={22} />
                  <strong>{t.upload}</strong>
                  <small>PDF · MD · HTML · TXT</small>
                </button>
                <button
                  onClick={() => {
                    setImportMode("url");
                    setModal("import");
                  }}
                >
                  <Link size={22} />
                  <strong>{t.fromLink}</strong>
                  <small>arXiv · blogs · research</small>
                </button>
                <button
                  onClick={() => {
                    setImportMode("paste");
                    setModal("import");
                  }}
                >
                  <FileText size={22} />
                  <strong>{t.paste}</strong>
                  <small>Markdown</small>
                </button>
              </div>
              <button
                className="text-button sample-button"
                onClick={() =>
                  void imported(() =>
                    api("paste", {
                      text: sample,
                      title: "A closer look at attention",
                    }),
                  )
                }
              >
                {importBusy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Sparkles size={16} />
                )}{" "}
                {t.sample}
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="welcome-footer">
              <ShieldCheck size={17} />
              {t.integrity}
            </div>
            {articles.length > 0 && (
              <div className="recent-grid">
                {articles.slice(0, 3).map((a) => (
                  <button key={a.id} onClick={() => void chooseArticle(a)}>
                    <FileText size={20} />
                    <strong>{a.title}</strong>
                    <ArrowUpRight size={18} />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <section className="article-heading">
              <div className="article-kicker">
                <span className="pill">{article.kind.toUpperCase()}</span>
                <span>
                  {Math.ceil(
                    article.units
                      .map((u) => u.text)
                      .join(" ")
                      .split(/\s+/).length / 220,
                  )}{" "}
                  {t.readTime}
                </span>
                <span className="dot-separator">•</span>
                <span>
                  {total} {t.units}
                </span>
              </div>
              <div className="title-row">
                <h1>{article.title}</h1>
                <div className="title-actions">
                  {article.source && (
                    <button
                      className="icon-button"
                      title={t.source}
                      onClick={() => api("openSource", article.id).catch(fail)}
                    >
                      <ArrowUpRight size={19} />
                    </button>
                  )}
                  <button
                    className="icon-button danger"
                    title={t.delete}
                    disabled={busy}
                    onClick={async () => {
                      if (confirm(t.deleteConfirm)) {
                        try {
                          await flush();
                          await api("remove", article.id);
                          setArticles((all) =>
                            all.filter((a) => a.id !== article.id),
                          );
                          setActiveId("");
                        } catch (e) {
                          fail(e);
                        }
                      }
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
              <div className="article-meta">
                <span className="integrity-badge">
                  <ShieldCheck size={14} />
                  {t.integrity}
                </span>
                {article.translationModel && (
                  <span>{article.translationModel}</span>
                )}
              </div>
            </section>
            <div className="workspace-bar">
              <nav className="tabs">
                {(
                  [
                    ["reader", BookOpen],
                    ["report", Sparkles],
                    ["writing", NotebookPen],
                  ] as const
                ).map(([id, Icon]) => (
                  <button
                    key={id}
                    className={tab === id ? "active" : ""}
                    onClick={() => setTab(id)}
                  >
                    <Icon size={16} />
                    {t[id]}
                  </button>
                ))}
              </nav>
              <button
                className="model-button"
                onClick={() => void openModels()}
              >
                <span className="model-dot" />
                <span>{chosen?.name || settings.model || t.pickModel}</span>
                <ChevronDown size={14} />
              </button>
            </div>
            {busy && (
              <div className="progress-bar">
                <LoaderCircle size={15} className="spin" />
                <span>
                  {progress?.stage === "translation"
                    ? t.translation
                    : progress?.stage === "evidence"
                      ? t.evidence
                      : progress?.stage === "blog"
                        ? t.blogProgress
                        : t.reportProgress}
                </span>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${progress?.total ? Math.max(5, ((progress.done || 0) / progress.total) * 100) : 5}%`,
                    }}
                  />
                </div>
                <span>
                  {progress?.done || 0} / {progress?.total || 1}
                </span>
                <button
                  className="text-button"
                  onClick={() => api("cancel").catch(fail)}
                >
                  {t.cancel}
                </button>
              </div>
            )}
            {tab === "reader" && (
              <>
                <div className="reader-toolbar">
                  <span className="status-label">
                    {complete ? (
                      <CheckCheck size={15} />
                    ) : (
                      <span className="status-dot" />
                    )}
                    {complete
                      ? t.completed
                      : done
                        ? `${done} / ${total} ${t.translated.toLocaleLowerCase()}`
                        : t.ready}
                  </span>
                  <div className="toolbar-actions">
                    {selection.length > 0 && (
                      <>
                        <span className="selection-count">
                          {selection.length} {t.selected}
                        </span>
                        <button
                          className="button small"
                          disabled={busy}
                          onClick={() => {
                            void editArticle({
                              locked: Array.from(
                                new Set([...article.locked, ...selection]),
                              ),
                            });
                            setSelection([]);
                          }}
                        >
                          <Lock size={13} />
                          {t.lock}
                        </button>
                        <button
                          className="button small primary"
                          disabled={
                            busy ||
                            (article.kind === "pdf" && !article.pdfReviewed)
                          }
                          onClick={() => void run("translate", selection)}
                        >
                          {t.translateSelected}
                        </button>
                        <button
                          className="icon-button"
                          title={t.clear}
                          onClick={() => setSelection([])}
                        >
                          <X size={15} />
                        </button>
                      </>
                    )}
                    {!selection.length && (
                      <>
                        <button
                          className="icon-button"
                          title={t.exportTranslation}
                          onClick={() => void exportFile("translation")}
                        >
                          <Download size={17} />
                        </button>
                        {article.locked.length > 0 && (
                          <button
                            className="icon-button"
                            title={t.unlock}
                            disabled={busy}
                            onClick={() => void editArticle({ locked: [] })}
                          >
                            <Lock size={16} />
                          </button>
                        )}
                        <button
                          className="button small primary"
                          disabled={
                            busy ||
                            complete ||
                            !total ||
                            (article.kind === "pdf" && !article.pdfReviewed)
                          }
                          onClick={() => void run("translate")}
                        >
                          <Languages size={15} />
                          {complete
                            ? t.completed
                            : done
                              ? t.resume
                              : t.translate}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {article.kind === "pdf" && (
                  <div className="pdf-notice">
                    <AlertCircle size={18} />
                    <div>
                      {t.pdfWarning}
                      <label>
                        <input
                          type="checkbox"
                          checked={!!article.pdfReviewed}
                          onChange={(e) =>
                            void editArticle({ pdfReviewed: e.target.checked })
                          }
                        />
                        {t.pdfReview}
                      </label>
                    </div>
                  </div>
                )}
                <div className="reading-panes">
                  <section className="reading-pane">
                    <div className="pane-label">
                      <span>
                        <span className="language-tag">EN</span>
                        {t.english}
                      </span>
                      {article.kind === "pdf" ? (
                        <button
                          className="text-button"
                          onClick={() => setPdfMode(!pdfMode)}
                        >
                          {pdfMode ? t.pdfText : t.pdfPages}
                        </button>
                      ) : (
                        <span className="pane-hint">{t.original}</span>
                      )}
                    </div>
                    <div
                      ref={sourceRef}
                      className="article-scroll"
                      onMouseUp={selectPassage}
                      onKeyUp={selectPassage}
                      onScroll={() => scrollSync("source")}
                    >
                      {article.kind === "pdf" && pdfMode ? (
                        <PdfView id={article.id} onError={fail} />
                      ) : (
                        <div
                          className="prose"
                          lang="en"
                          dangerouslySetInnerHTML={{ __html: sourceHtml }}
                        />
                      )}
                    </div>
                  </section>
                  <section className="reading-pane translated-pane">
                    <div className="pane-label">
                      <span>
                        <span className="language-tag accent">TR</span>
                        {t.turkish}
                      </span>
                      <span className="pane-hint">
                        <ShieldCheck size={13} />
                        {t.protected}
                      </span>
                    </div>
                    <div
                      ref={targetRef}
                      className="article-scroll"
                      onScroll={() => scrollSync("target")}
                    >
                      {!done ? (
                        <div className="translation-empty">
                          <div className="translation-symbol">
                            <Languages size={32} />
                            <span>
                              <Sparkles size={12} />
                            </span>
                          </div>
                          <h2>{t.noTranslation}</h2>
                          <p>{t.noTranslationSub}</p>
                          <div className="mini-divider" />
                          <small>{t.translateHint}</small>
                        </div>
                      ) : (
                        <div
                          className="prose"
                          lang="tr"
                          dangerouslySetInnerHTML={{ __html: targetHtml }}
                        />
                      )}
                    </div>
                  </section>
                </div>
                <footer className="reader-footer">
                  <span>
                    <Lock size={12} />
                    {t.selectionHint}
                  </span>
                  <span>
                    {done} / {total}
                    <i className="footer-meter">
                      <b
                        style={{
                          width: `${total ? (done / total) * 100 : 0}%`,
                        }}
                      />
                    </i>
                  </span>
                </footer>
              </>
            )}
            {tab === "report" && (
              <div className="report-page">
                {article.report ? (
                  <>
                    <div className="document-toolbar">
                      <div>
                        <span className="pill purple">{t.report}</span>
                        <small>{article.reportModel}</small>
                      </div>
                      <div>
                        <button
                          className="button small"
                          onClick={() => void exportFile("report")}
                        >
                          <Download size={14} />
                          {t.export}
                        </button>
                        <button
                          className="button small"
                          disabled={busy || !complete}
                          onClick={() => void run("report")}
                        >
                          <RefreshCw size={14} />
                          {t.regenerate}
                        </button>
                      </div>
                    </div>
                    <p className="report-disclaimer">{t.reportNote}</p>
                    <article
                      className="prose report-prose"
                      onClick={evidenceClick}
                      dangerouslySetInnerHTML={{ __html: reportHtml }}
                    />
                  </>
                ) : (
                  <div className="section-empty">
                    <div className="section-icon">
                      <Sparkles size={32} />
                    </div>
                    <span className="eyebrow">{t.report}</span>
                    <h2>{t.reportTitle}</h2>
                    <p>{t.reportSub}</p>
                    <div className="report-topics">
                      {(settings.language === "tr"
                        ? [
                            "Mimari ve yöntem",
                            "Eğitim ve veri kümeleri",
                            "GPU ve hesaplama",
                            "Sonuçlar ve sınırlılıklar",
                          ]
                        : [
                            "Architecture & methods",
                            "Training & datasets",
                            "GPU & compute",
                            "Results & limitations",
                          ]
                      ).map((x) => (
                        <span key={x}>
                          <Check size={14} />
                          {x}
                        </span>
                      ))}
                    </div>
                    <button
                      className="button primary"
                      disabled={busy || !complete}
                      onClick={() => void run("report")}
                    >
                      <Sparkles size={16} />
                      {t.generateReport}
                    </button>
                    <small>{complete ? t.reportHint : t.reportRequired}</small>
                  </div>
                )}
              </div>
            )}
            {tab === "writing" && (
              <div className="writing-page">
                <div className="writing-top">
                  <span
                    className={
                      saveStatus === "unsaved" ? "save-error" : "save-label"
                    }
                  >
                    {saveStatus === "saving" ? (
                      <LoaderCircle size={13} className="spin" />
                    ) : (
                      <Check size={13} />
                    )}{" "}
                    {t[saveStatus as "saved"]}
                  </span>
                  {saveStatus === "unsaved" && (
                    <button
                      className="text-button"
                      onClick={() => void flush().catch(fail)}
                    >
                      {t.retrySave}
                    </button>
                  )}
                  <button
                    className="text-button"
                    onClick={() => void exportFile("backup")}
                  >
                    <Download size={14} />
                    {t.backup}
                  </button>
                </div>
                <div className="writing-grid">
                  <section className="editor-card">
                    <header>
                      <div className="editor-title">
                        <NotebookPen size={20} />
                        <div>
                          <h2>{t.notes}</h2>
                          <p>{t.notesSub}</p>
                        </div>
                      </div>
                      <button
                        className="icon-button"
                        title={t.downloadNotes}
                        onClick={() => void exportFile("notes")}
                      >
                        <Download size={17} />
                      </button>
                    </header>
                    <textarea
                      aria-label={t.notes}
                      value={article.notes}
                      onChange={(e) => updateDraft("notes", e.target.value)}
                      placeholder={t.notesPlaceholder}
                    />
                    <footer>
                      <span>Markdown</span>
                      <span>
                        {article.notes.trim()
                          ? article.notes.trim().split(/\s+/).length
                          : 0}{" "}
                        {t.words}
                      </span>
                    </footer>
                  </section>
                  <section className="editor-card">
                    <header>
                      <div className="editor-title">
                        <PenLine size={20} />
                        <div>
                          <h2>{t.blog}</h2>
                          <p>{t.blogSub}</p>
                        </div>
                      </div>
                      <button
                        className="icon-button"
                        title={t.downloadBlog}
                        onClick={() => void exportFile("blog")}
                      >
                        <Download size={17} />
                      </button>
                    </header>
                    <div className="blog-toolbar">
                      <div className="segmented">
                        <button
                          className={!blogPreview ? "active" : ""}
                          onClick={() => setBlogPreview(false)}
                        >
                          {t.edit}
                        </button>
                        <button
                          className={blogPreview ? "active" : ""}
                          onClick={() => setBlogPreview(true)}
                        >
                          {t.preview}
                        </button>
                      </div>
                      <button
                        className="text-button"
                        disabled={busy || !article.report}
                        title={!article.report ? t.generateReport : undefined}
                        onClick={() => void run("blog")}
                      >
                        <Sparkles size={14} />
                        {t.generateBlog}
                      </button>
                    </div>
                    {blogPreview ? (
                      <div
                        className="prose blog-preview"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(article.blog),
                        }}
                      />
                    ) : (
                      <textarea
                        aria-label={t.blog}
                        value={article.blog}
                        onChange={(e) => updateDraft("blog", e.target.value)}
                        placeholder={t.blogPlaceholder}
                      />
                    )}
                    <footer>
                      <span>Markdown</span>
                      <span>
                        {article.blog.trim()
                          ? article.blog.trim().split(/\s+/).length
                          : 0}{" "}
                        {t.words}
                      </span>
                    </footer>
                  </section>
                </div>
              </div>
            )}
          </>
        )}
      </main>
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !importBusy) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "settings" ? "settings-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "settings"
                ? t.settings
                : modal === "models"
                  ? t.model
                  : t.newArticle
            }
          >
            <header className="modal-header">
              <h2>
                {modal === "settings"
                  ? t.settings
                  : modal === "models"
                    ? t.model
                    : t.newArticle}
              </h2>
              <button
                className="icon-button"
                aria-label={t.close}
                disabled={importBusy}
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </header>
            {error && (
              <div role="alert" className="error-banner">
                <AlertCircle size={18} />
                <span>{error}</span>
                <button
                  className="icon-button"
                  aria-label={t.dismiss}
                  onClick={() => setError("")}
                >
                  <X size={17} />
                </button>
              </div>
            )}
            {modal === "import" && (
              <div className="modal-body">
                <button
                  className="upload-drop"
                  disabled={importBusy}
                  onClick={() => void imported(() => api("upload"))}
                >
                  <div className="section-icon">
                    <Upload size={24} />
                  </div>
                  <strong>{t.upload}</strong>
                  <small>{t.formats}</small>
                </button>
                <div className="segmented wide">
                  <button
                    className={importMode === "url" ? "active" : ""}
                    onClick={() => setImportMode("url")}
                  >
                    <Link size={15} />
                    {t.fromLink}
                  </button>
                  <button
                    className={importMode === "paste" ? "active" : ""}
                    onClick={() => setImportMode("paste")}
                  >
                    <FileText size={15} />
                    {t.paste}
                  </button>
                </div>
                {importMode === "url" ? (
                  <label className="field">
                    URL
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder={t.linkPlaceholder}
                      autoFocus
                    />
                  </label>
                ) : (
                  <>
                    <label className="field">
                      {t.title}
                      <input
                        value={pasteTitle}
                        onChange={(e) => setPasteTitle(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      {t.content}
                      <textarea
                        rows={9}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                      />
                    </label>
                  </>
                )}
                <button
                  className="button primary full-width"
                  disabled={
                    importBusy ||
                    !(importMode === "url" ? url : pasteText).trim()
                  }
                  onClick={() =>
                    void imported(() =>
                      api(
                        importMode === "url" ? "url" : "paste",
                        importMode === "url"
                          ? url
                          : { title: pasteTitle, text: pasteText },
                      ),
                    )
                  }
                >
                  {importBusy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <ArrowRight size={16} />
                  )}{" "}
                  {importBusy ? t.loading : t.import}
                </button>
              </div>
            )}
            {modal === "models" && (
              <div className="modal-body">
                <div className="search-box model-search">
                  <Search size={18} />
                  <input
                    autoFocus
                    aria-label={t.modelSearch}
                    placeholder={t.modelSearch}
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                  />
                  <button
                    className="icon-button"
                    aria-label={t.refresh}
                    onClick={() => void loadModels()}
                  >
                    <RefreshCw
                      size={16}
                      className={loadingModels ? "spin" : ""}
                    />
                  </button>
                </div>
                <p className="field-hint">{t.costHint}</p>
                <div className="model-list">
                  {loadingModels && !models.length ? (
                    <div className="model-loading">
                      <LoaderCircle className="spin" />
                      {t.loading}
                    </div>
                  ) : (
                    models
                      .filter((m) =>
                        (m.id + " " + m.name)
                          .toLowerCase()
                          .includes(modelSearch.toLowerCase()),
                      )
                      .map((m) => (
                        <button
                          key={m.id}
                          className={settings.model === m.id ? "chosen" : ""}
                          onClick={() => {
                            void changeSettings({ model: m.id });
                            setModal(null);
                          }}
                        >
                          <div>
                            <strong>{m.name}</strong>
                            <small>
                              {m.id} · {(m.context / 1000).toFixed(0)}k{" "}
                              {t.context}
                            </small>
                            <small>
                              ${(Number(m.promptPrice) * 1e6).toFixed(2)}{" "}
                              {t.input} · $
                              {(Number(m.completionPrice) * 1e6).toFixed(2)}{" "}
                              {t.output}
                            </small>
                          </div>
                          {settings.model === m.id ? (
                            <Check size={18} />
                          ) : (
                            <ArrowRight size={17} />
                          )}
                        </button>
                      ))
                  )}
                </div>
                <small className="muted">
                  {models.length} {t.models}
                </small>
              </div>
            )}
            {modal === "settings" && (
              <div className="modal-body">
                <section className="settings-section">
                  <h3>{t.appearance}</h3>
                  <label className="field">{t.theme}</label>
                  <div className="theme-options">
                    {(
                      [
                        ["light", Sun],
                        ["dark", Moon],
                        ["system", Monitor],
                      ] as const
                    ).map(([value, Icon]) => (
                      <button
                        key={value}
                        className={settings.theme === value ? "active" : ""}
                        onClick={() => void changeSettings({ theme: value })}
                      >
                        <Icon size={20} />
                        {t[value]}
                      </button>
                    ))}
                  </div>
                  <label className="field">
                    {t.language}
                    <select
                      value={settings.language}
                      onChange={(e) =>
                        void changeSettings({
                          language: e.target.value as "en" | "tr",
                        })
                      }
                    >
                      <option value="tr">Türkçe</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                </section>
                <section className="settings-section">
                  <div className="settings-title">
                    <h3>{t.apiKey}</h3>
                    <span
                      className={`key-status ${keyConfigured ? "connected" : ""}`}
                    >
                      <span />
                      {keyConfigured ? t.keySet : t.keyMissing}
                    </span>
                  </div>
                  <p className="field-hint">{t.keyHint}</p>
                  <div className="key-input">
                    <input
                      type="password"
                      autoComplete="off"
                      aria-label={t.apiKey}
                      placeholder="sk-or-v1-…"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                    />
                    <button
                      className="button primary"
                      disabled={!keyInput}
                      onClick={async () => {
                        try {
                          const result = await api<{
                            keyConfigured: boolean;
                            keySecure: boolean;
                          }>("key", keyInput);
                          setKeyConfigured(result.keyConfigured);
                          setKeySecure(result.keySecure);
                          setKeyInput("");
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    >
                      {t.save}
                    </button>
                  </div>
                  {!keySecure && (
                    <p className="field-hint amber">{t.sessionKey}</p>
                  )}
                  {keyConfigured && (
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await api("key", "");
                          setKeyConfigured(false);
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    >
                      {t.removeKey}
                    </button>
                  )}
                </section>
                <section className="settings-section">
                  <h3>{t.glossary}</h3>
                  <p className="field-hint">{t.glossaryHint}</p>
                  <textarea
                    className="glossary-input"
                    aria-label={t.glossary}
                    rows={5}
                    value={settings.terms.join("\n")}
                    onChange={(e) =>
                      void changeSettings({ terms: e.target.value.split("\n") })
                    }
                    placeholder={"Transformer\nlearning rate\nyour_term"}
                  />
                  <details>
                    <summary>
                      {t.defaultTerms} ({defaultTerms.length})
                    </summary>
                    <div className="term-tags">
                      {defaultTerms.map((x) => (
                        <span key={x}>{x}</span>
                      ))}
                    </div>
                  </details>
                </section>
                <p className="privacy-note">
                  <ShieldCheck size={18} />
                  {t.privacy}
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
