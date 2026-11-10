// file-service.ts —— Tauri 文件 IPC 的唯一前端适配器；测试可注入 fake。
import { invoke } from "@tauri-apps/api/core";
import { fallbackPathKey } from "./state";

export interface FileMetadata {
  mtimeMs: number;
  size: number;
  pathKey: string;
  fingerprint: string;
}

export interface OpenFileResult extends FileMetadata {
  content: string;
  encoding: string;
}

export interface SaveFileRequest {
  path: string;
  content: string;
  allowEmpty: boolean;
  expectedFingerprint: string | null;
  force: boolean;
}

export interface FileService {
  pathKey(path: string): Promise<string>;
  openFile(path: string): Promise<OpenFileResult>;
  statFile(path: string): Promise<FileMetadata | null>;
  saveFile(request: SaveFileRequest): Promise<FileMetadata>;
  saveDocx(path: string, dataBase64: string): Promise<void>;
}

export interface VersionInfo { id: string; modifiedMs: number; encoding: string; size: number }
export interface ArchiveService {
  listVersions(path: string): Promise<VersionInfo[]>;
  readVersion(path: string, id: string): Promise<string>;
}
const tauriArchiveService: ArchiveService = {
  listVersions: path => invoke<VersionInfo[]>("list_versions", { path }),
  readVersion: (path, id) => invoke<string>("read_version", { path, id }),
};
let archives: ArchiveService = tauriArchiveService;
export function archiveService(): ArchiveService { return archives; }
export function setArchiveServiceForTests(service: ArchiveService | null): void { archives = service || tauriArchiveService; }

export class FileConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileConflictError";
  }
}

function normalizeError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("FILE_CHANGED:")) {
    return new FileConflictError(message.slice(message.indexOf("FILE_CHANGED:") + 13).trim());
  }
  return error instanceof Error ? error : new Error(message);
}

const tauriFileService: FileService = {
  pathKey: path => invoke<string>("file_path_key", { path }),
  async openFile(path) {
    try {
      const [content, encoding, mtimeMs, size, pathKey, fingerprint] =
        await invoke<[string, string, number, number, string, string]>("open_file", { path });
      return { content, encoding, mtimeMs, size, pathKey, fingerprint };
    } catch (error) {
      throw normalizeError(error);
    }
  },
  async statFile(path) {
    try {
      const result = await invoke<[number, number, string, string] | null>("file_stat", { path });
      if (!result) return null;
      const [mtimeMs, size, pathKey, fingerprint] = result;
      return { mtimeMs, size, pathKey, fingerprint };
    } catch (error) {
      throw normalizeError(error);
    }
  },
  async saveFile(request) {
    try {
      const [mtimeMs, size, pathKey, fingerprint] = await invoke<[number, number, string, string]>("save_file", {
        path: request.path,
        content: request.content,
        allowEmpty: request.allowEmpty,
        expectedFingerprint: request.expectedFingerprint,
        force: request.force,
      });
      return { mtimeMs, size, pathKey, fingerprint };
    } catch (error) {
      throw normalizeError(error);
    }
  },
  async saveDocx(path, dataBase64) {
    try {
      await invoke("save_docx", { path, dataBase64 });
    } catch (error) {
      throw normalizeError(error);
    }
  },
};

let currentFileService: FileService = tauriFileService;

export function fileService(): FileService {
  return currentFileService;
}

export function setFileServiceForTests(service: (Omit<FileService, "pathKey"> & Partial<Pick<FileService, "pathKey">>) | null): void {
  // Only injected browser fakes use a lexical identity; production always asks Rust.
  currentFileService = service ? { pathKey: async path => fallbackPathKey(path), ...service } : tauriFileService;
}

export interface ExportService { saveHtml(path: string, html: string): Promise<void> }
const nativeExportService: ExportService = { saveHtml: (path, html) => invoke("save_html", { path, html }) };
let exportsAdapter = nativeExportService;
export function exportService(): ExportService { return exportsAdapter; }
export function setExportServiceForTests(service: ExportService | null): void { exportsAdapter = service || nativeExportService; }

export interface PdfService { renderPdf(path: string, html: string): Promise<void> }
const nativePdfService: PdfService = { renderPdf: (path, html) => invoke("render_pdf", { path, html }) };
let pdfAdapter = nativePdfService;
export function pdfService(): PdfService { return pdfAdapter; }
export function setPdfServiceForTests(service: PdfService | null): void { pdfAdapter = service || nativePdfService; }

export interface LinkResource { path: string; kind: "document" | "source" | "external" | "directory" }
export interface TextPreview { path: string; content: string; encoding: string }
export interface ResourceService {
  inspect(path: string): Promise<LinkResource>;
  readText(path: string): Promise<TextPreview>;
  openDefault(path: string): Promise<void>;
  openEditor(path: string, editor: string, line: number, column: number): Promise<void>;
}
const nativeResourceService: ResourceService = {
  inspect: path => invoke("inspect_link_resource", { path }),
  readText: path => invoke("read_link_text", { path }),
  openDefault: path => invoke("open_link_resource", { path }),
  openEditor: (path, editor, line, column) => invoke("open_link_in_editor", { path, editor, line, column }),
};
let resourceAdapter = nativeResourceService;
export function resourceService(): ResourceService { return resourceAdapter; }
export function setResourceServiceForTests(service: ResourceService | null): void { resourceAdapter = service || nativeResourceService; }

export interface AssetService { readImage(sourcePath: string | null, reference: string): Promise<string> }
const nativeAssetService: AssetService = { readImage: (sourcePath, reference) => invoke("read_export_image", {sourcePath, reference}) };
let assetAdapter = nativeAssetService;
export function assetService(): AssetService { return assetAdapter; }
export function setAssetServiceForTests(value: AssetService | null): void { assetAdapter = value || nativeAssetService; }

export interface ImageStoreService { store(sourcePath: string | null, data: string): Promise<string> }
const nativeImageStore: ImageStoreService = { store: (sourcePath, data) => invoke("store_image", { sourcePath, data }) };
let imageStoreAdapter = nativeImageStore;
export function imageStoreService(): ImageStoreService { return imageStoreAdapter; }
export function setImageStoreForTests(value: ImageStoreService | null): void { imageStoreAdapter = value || nativeImageStore; }

export interface DirectoryEntry { name: string; path: string; directory: boolean }
export interface NavigationService { list(path: string): Promise<{entries: DirectoryEntry[]; truncated: boolean}> }
const nativeNavigation: NavigationService = { list: path => invoke("list_directory", {path}) };
let navigationAdapter = nativeNavigation;
export function navigationService(): NavigationService { return navigationAdapter; }
export function setNavigationServiceForTests(value: NavigationService | null): void { navigationAdapter = value || nativeNavigation; }

export interface OutputService { savePng(path: string, dataBase64: string): Promise<void>; printHtml(html: string): Promise<void> }
const nativeOutput: OutputService = { savePng: (path,dataBase64)=>invoke("save_png",{path,dataBase64}), printHtml: html=>invoke("print_html",{html}) };
let outputAdapter=nativeOutput;
export function outputService(): OutputService {return outputAdapter;}
export function setOutputServiceForTests(value: OutputService|null):void {outputAdapter=value||nativeOutput;}
