import { getIndexedDbValue, setIndexedDbValue } from "@/common/utils/cache/indexed-db"

/**
 * 配方文件保存（File System Access API）：
 * - 首次由用户选择保存目录，句柄持久化到 IndexedDB，之后所有配方都保存到该目录
 * - 不支持的浏览器（Firefox/Safari）回退为下载 JSON 文件
 */

/** File System Access API 最小类型声明（兼容 TS lib 缺失场景） */
export interface FSWritableFile {
  write(data: string): Promise<void>
  close(): Promise<void>
}
export interface FSFileHandle {
  createWritable(): Promise<FSWritableFile>
}
export interface FSDirHandle {
  name: string
  queryPermission?(opts?: { mode?: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">
  requestPermission?(opts?: { mode?: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FSFileHandle>
}

const DIR_HANDLE_KEY = "multistep-recipe-dir-handle"

/** 当前浏览器是否支持目录选择 */
export function isDirPickerAvailable(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function"
}

/** 请用户选择配方保存目录，并持久化句柄 */
export async function chooseRecipeDir(): Promise<string | null> {
  if (!isDirPickerAvailable()) return null
  const handle = (await (window as any).showDirectoryPicker({ mode: "readwrite" })) as FSDirHandle
  await persistDirHandle(handle)
  return handle.name
}

/** 恢复上次选择的目录句柄（可能需要用户重新授权） */
export async function getSavedRecipeDir(): Promise<FSDirHandle | null> {
  if (!isDirPickerAvailable()) return null
  const handle = await getIndexedDbValue<FSDirHandle>(DIR_HANDLE_KEY)
  if (!handle) return null
  let perm = handle.queryPermission ? await handle.queryPermission({ mode: "readwrite" }) : "granted"
  if (perm === "denied") return null
  if (perm === "prompt" && handle.requestPermission) {
    perm = await handle.requestPermission({ mode: "readwrite" })
  }
  return perm === "granted" ? handle : null
}

async function persistDirHandle(handle: FSDirHandle) {
  await setIndexedDbValue(DIR_HANDLE_KEY, handle)
}

/** 清洗文件名中的非法字符 */
export function sanitizeFileName(name: string): string {
  return (name.replace(/[\\/:*?"<>|]/g, "_").trim() || "recipe")
}

/** 把配方 JSON 写入所选目录 */
export async function writeRecipeFile(dir: FSDirHandle, name: string, json: string): Promise<void> {
  const file = await dir.getFileHandle(`${sanitizeFileName(name)}.json`, { create: true })
  const writable = await file.createWritable()
  await writable.write(json)
  await writable.close()
}

/** 不支持目录选择时的回退：下载 JSON 文件 */
export function downloadRecipeJson(name: string, json: string) {
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${sanitizeFileName(name)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
