import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import {
  CURSOR_MARKER,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type TUI,
} from "@mariozechner/pi-tui";

type Mode = "widget" | "status" | "both" | "off" | "inline";
type Placement = "aboveEditor" | "belowEditor";
type InlineBorder = "full" | "none";
type FooterMode = "default" | "compact" | "off";

const STATUS_KEY = "starship-prompt";
const WIDGET_KEY = "starship-prompt";
let inlinePromptLine: string | null = null;
let inlineBorder: InlineBorder = "none";
let footerMode: FooterMode | null = null;

function getMode(): Mode {
  const raw = process.env.PI_STARSHIP_MODE?.toLowerCase();
  if (raw === "status" || raw === "widget" || raw === "both" || raw === "off" || raw === "inline") {
    return raw;
  }
  return "inline";
}

function getPlacement(): Placement {
  const raw = process.env.PI_STARSHIP_PLACEMENT?.toLowerCase();
  if (raw === "above" || raw === "aboveeditor") return "aboveEditor";
  if (raw === "below" || raw === "beloweditor") return "belowEditor";
  return "aboveEditor";
}

function getInlineBorder(): InlineBorder {
  const raw = process.env.PI_STARSHIP_INLINE_BORDER?.toLowerCase();
  if (raw === "full" || raw === "none") return raw;
  return "none";
}

function getFooterMode(): FooterMode {
  const raw = process.env.PI_STARSHIP_FOOTER?.toLowerCase();
  if (raw === "default" || raw === "compact" || raw === "off") return raw;

  const legacy = process.env.PI_STARSHIP_HIDE_FOOTER?.toLowerCase();
  if (legacy === "1" || legacy === "true" || legacy === "yes") return "off";
  if (legacy === "0" || legacy === "false" || legacy === "no") return "default";

  return "compact";
}

function formatCount(value: number): string {
  if (value < 1000) return `${value}`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value / 1000)}k`;
}

function buildEnv(): Record<string, string> {
  const columns = process.stdout?.columns ?? 80;
  const env: Record<string, string> = {
    ...process.env,
    STARSHIP_SHELL: process.env.STARSHIP_SHELL ?? "bash",
    STARSHIP_SESSION_KEY: process.env.STARSHIP_SESSION_KEY ?? "pi",
    COLUMNS: String(columns),
  };

  const configPath = process.env.PI_STARSHIP_CONFIG ?? process.env.STARSHIP_CONFIG;
  if (configPath) env.STARSHIP_CONFIG = configPath;

  return env;
}

function sanitizePrompt(prompt: string): string {
  return prompt.replace(/%\{|%\}/g, "");
}

async function fetchPrompt(pi: ExtensionAPI, ctx: ExtensionContext, signal?: AbortSignal): Promise<string> {
  const result = await pi.exec("starship", ["prompt"], {
    cwd: ctx.cwd,
    env: buildEnv(),
    signal,
  });

  if (result.code !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const suffix = stderr ? `: ${stderr}` : "";
    throw new Error(`starship exited with ${result.code}${suffix}`);
  }

  const raw = result.stdout?.replace(/\s+$/, "") ?? "";
  return sanitizePrompt(raw);
}

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

function needsSeparator(prompt: string, rest: string): boolean {
  const promptText = stripAnsi(prompt);
  const restText = stripAnsi(rest);
  if (!promptText || !restText) return false;
  return !/\s$/.test(promptText) && !/^\s/.test(restText);
}

function injectPrompt(line: string, prompt: string, width: number): string {
  if (!prompt) return line;

  const borderMatch = line.match(/^(\s*[│┃║|]\s?)/);
  const prefix = borderMatch ? borderMatch[1] ?? "" : line.match(/^\s*/)?.[0] ?? "";
  const rest = line.slice(prefix.length);
  const separator = needsSeparator(prompt, rest) ? " " : "";

  const markerIndex = rest.indexOf(CURSOR_MARKER);
  let beforeMarker = rest;
  let marker = "";
  let afterMarker = "";

  if (markerIndex >= 0) {
    beforeMarker = rest.slice(0, markerIndex);
    marker = CURSOR_MARKER;
    afterMarker = rest.slice(markerIndex + CURSOR_MARKER.length);
  }

  const promptText = `${prefix}${prompt}${separator}`;
  const available = width - visibleWidth(promptText);
  const remaining =
    available > 0
      ? truncateToWidth(`${beforeMarker}${marker}${afterMarker}`, available, "")
      : "";

  if (marker && !remaining.includes(CURSOR_MARKER)) {
    return truncateToWidth(`${promptText}${CURSOR_MARKER}`, width, "");
  }

  return truncateToWidth(`${promptText}${remaining}`, width, "");
}

type AutocompleteEditorInternals = {
  autocompleteList?: Pick<Component, "render">;
  isShowingAutocomplete?: () => boolean;
};

class StarshipInlineEditor extends CustomEditor {
  private promptLine = "";
  private uiTheme: Theme;
  private inlineBorder: InlineBorder;
  private readonly reset = "\x1b[0m";

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    uiTheme: Theme,
    inlineBorder: InlineBorder
  ) {
    super(tui, theme, keybindings, { paddingX: 0 });
    this.uiTheme = uiTheme;
    this.inlineBorder = inlineBorder;
    this.borderColor = (text: string) => uiTheme.fg("border", text);
  }

  setPromptLine(line: string): void {
    if (line === this.promptLine) return;
    this.promptLine = line;
    this.tui.requestRender();
  }

  clearPromptLine(): void {
    if (!this.promptLine) return;
    this.promptLine = "";
    this.tui.requestRender();
  }

  private fillLine(content: string, width: number): string {
    const truncated = truncateToWidth(content, width, "");
    const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
    return `${truncated}${pad}`;
  }

  render(width: number): string[] {
    const useBorder = this.inlineBorder === "full";
    const innerWidth = Math.max(1, width - (useBorder ? 2 : 0));
    const rendered = super.render(innerWidth);
    const editorInternals = this as unknown as AutocompleteEditorInternals;
    const isShowingAutocomplete =
      typeof editorInternals.isShowingAutocomplete === "function"
        ? Boolean(editorInternals.isShowingAutocomplete())
        : false;

    const autocompleteCount =
      isShowingAutocomplete && typeof editorInternals.autocompleteList?.render === "function"
        ? editorInternals.autocompleteList.render(innerWidth).length
        : 0;
    const editorFrame =
      autocompleteCount > 0 && autocompleteCount < rendered.length
        ? rendered.slice(0, -autocompleteCount)
        : rendered;
    const autocompleteLines =
      autocompleteCount > 0 && autocompleteCount < rendered.length
        ? rendered.slice(-autocompleteCount)
        : [];

    if (editorFrame.length < 2) {
      return super.render(width);
    }

    const editorLines = editorFrame.slice(1, -1);

    if (this.promptLine) {
      const cursorIndex = editorLines.findIndex((line) => line.includes(CURSOR_MARKER));
      const contentIndex = cursorIndex >= 0 ? cursorIndex : Math.max(0, editorLines.length - 1);
      editorLines[contentIndex] = injectPrompt(
        editorLines[contentIndex] ?? "",
        this.promptLine,
        innerWidth
      );
    }

    if (!useBorder) {
      return [
        ...editorLines.map((line) => this.fillLine(line, innerWidth)),
        ...autocompleteLines,
      ];
    }

    const rail = `${this.uiTheme.fg("accent", "│")}${this.reset} `;
    const top = this.uiTheme.fg("border", "─".repeat(width));
    const bottom = this.uiTheme.fg("border", "─".repeat(width));
    const body = editorLines.map((line) => `${rail}${this.fillLine(line, innerWidth)}`);

    return [top, ...body, bottom, ...autocompleteLines];
  }
}

function applyPrompt(
  ctx: ExtensionContext,
  prompt: string,
  mode: Mode,
  placement: Placement,
  editor: StarshipInlineEditor | null,
  setEditor: (enabled: boolean, ctx: ExtensionContext) => void
) {
  if (!ctx.hasUI) return;

  if (mode === "off") {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  const lines = prompt.length > 0 ? prompt.split(/\r?\n/) : ["(starship prompt empty)"];
  const statusLine = lines[lines.length - 1] ?? "";

  if (mode === "inline") {
    const promptLine = statusLine;
    const widgetLines = lines.slice(0, -1);
    inlinePromptLine = promptLine;
    setEditor(true, ctx);
    editor?.setPromptLine(promptLine);
    ctx.ui.setStatus(STATUS_KEY, undefined);
    if (widgetLines.length > 0) {
      ctx.ui.setWidget(WIDGET_KEY, widgetLines, { placement });
    } else {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }
    return;
  }

  inlinePromptLine = null;
  setEditor(false, ctx);

  if (mode === "status" || mode === "both") {
    ctx.ui.setStatus(STATUS_KEY, statusLine);
  } else {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }

  if (mode === "widget" || mode === "both") {
    ctx.ui.setWidget(WIDGET_KEY, lines, { placement });
  } else {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  }
}

function applyError(
  ctx: ExtensionContext,
  message: string,
  mode: Mode,
  placement: Placement,
  editor: StarshipInlineEditor | null,
  setEditor: (enabled: boolean, ctx: ExtensionContext) => void
) {
  if (!ctx.hasUI) return;

  const errorLine = `starship error: ${message}`;

  if (mode === "inline") {
    inlinePromptLine = errorLine;
    setEditor(true, ctx);
    editor?.setPromptLine(errorLine);
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }

  inlinePromptLine = null;
  setEditor(false, ctx);

  if (mode === "status" || mode === "both") {
    ctx.ui.setStatus(STATUS_KEY, errorLine);
  } else {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }

  if (mode === "widget" || mode === "both") {
    ctx.ui.setWidget(WIDGET_KEY, [errorLine], { placement });
  } else {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  }
}

export default function (pi: ExtensionAPI) {
  let updating = false;
  let pending = false;
  let lastPrompt: string | null = null;
  let lastError: string | null = null;
  let editor: StarshipInlineEditor | null = null;
  let editorEnabled = false;

  const setFooterMode = (mode: FooterMode, ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    if (mode === footerMode) return;
    footerMode = mode;

    if (mode === "off") {
      ctx.ui.setFooter((_tui, _theme) => ({
        render: (width: number) => [" ".repeat(Math.max(0, width))],
        invalidate: () => {},
      }));
      return;
    }

    if (mode === "compact") {
      ctx.ui.setFooter((_tui, theme) => ({
        render: (width: number) => {
          const usage = ctx.getContextUsage();
          const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
          const percent = usage?.percent;
          const percentLabel =
            percent === null || percent === undefined
              ? "?"
              : `${Math.max(0, Math.min(999, Math.round(percent)))}%`;
          const contextLabel = contextWindow
            ? `${percentLabel}/${formatCount(contextWindow)}`
            : "--";
          const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
          const thinking = pi.getThinkingLevel();
          const thinkingLabel = thinking && thinking !== "off" ? ` • ${thinking}` : "";
          const line = `${contextLabel}  ${modelLabel}${thinkingLabel}`;
          const dimLine = theme.fg("dim", line);
          return [" ".repeat(Math.max(0, width)), truncateToWidth(dimLine, width, "")];
        },
        invalidate: () => {},
      }));
      return;
    }

    ctx.ui.setFooter(undefined);
  };

  const setEditor = (enabled: boolean, ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    if (enabled === editorEnabled) return;
    editorEnabled = enabled;
    if (enabled) {
      ctx.ui.setEditorComponent((tui, theme, kb) => {
        editor = new StarshipInlineEditor(tui, theme, kb, ctx.ui.theme, inlineBorder);
        if (inlinePromptLine) editor.setPromptLine(inlinePromptLine);
        return editor;
      });
    } else {
      ctx.ui.setEditorComponent(undefined);
      editor = null;
    }
  };

  const update = async (ctx: ExtensionContext, signal?: AbortSignal) => {
    if (!ctx.hasUI) return;
    if (updating) {
      pending = true;
      return;
    }

    updating = true;
    const mode = getMode();
    const placement = getPlacement();
    inlineBorder = getInlineBorder();
    setFooterMode(getFooterMode(), ctx);

    try {
      const prompt = await fetchPrompt(pi, ctx, signal);
      if (prompt !== lastPrompt || lastError !== null) {
        applyPrompt(ctx, prompt, mode, placement, editor, setEditor);
      }
      lastPrompt = prompt;
      lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError || lastPrompt !== null) {
        applyError(ctx, message, mode, placement, editor, setEditor);
      }
      lastError = message;
      lastPrompt = null;
    } finally {
      updating = false;
      if (pending) {
        pending = false;
        void update(ctx, signal);
      }
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    await update(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await update(ctx, ctx.signal);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    ctx.ui.setEditorComponent(undefined);
    ctx.ui.setFooter(undefined);
    editor = null;
    editorEnabled = false;
    inlinePromptLine = null;
    footerMode = null;
  });

  pi.registerCommand("starship-refresh", {
    description: "Refresh starship prompt widget",
    handler: async (_args, ctx) => {
      await update(ctx);
      if (ctx.hasUI) ctx.ui.notify("Starship prompt refreshed", "info");
    },
  });
}
