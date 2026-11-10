// 文档中的源码链接可以直接定位到这里。
interface Note {
  title: string;
  body: string;
  saved: boolean;
}

export function createNote(title: string): Note {
  return { title, body: "从一个想法开始", saved: false };
}

export function markSaved(note: Note): Note {
  return { ...note, saved: true };
}
