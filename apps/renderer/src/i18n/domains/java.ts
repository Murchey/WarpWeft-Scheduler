/**
 * JDK 环境检测相关文案。
 *
 * 排课依赖 Java 21+ 求解器；缺了它其余功能正常，只有排课会失败，
 * 因此提示措辞要区分「完全没装」与「版本太旧」，并给出可点击的下载源。
 */
export const javaMessages = {
  'java.titleMissing': '未检测到 Java 运行环境',
  'java.titleOld': 'Java 版本过低',
  'java.leadMissing':
    '排课需要 Java 21 或更高版本的运行环境，但没有找到 java 命令。安装后点击「重新检测」即可，不需要重启应用。',
  'java.leadOld':
    '排课需要 Java 21 或更高版本，当前检测到的是 Java {version}。请升级后点击「重新检测」。',
  'java.source.oracle': 'Oracle JDK 21（长期支持）',
  'java.source.microsoft': 'Microsoft Build of OpenJDK',
  'java.source.openjdk': 'OpenJDK 21（jdk.java.net）',
  'java.hintHome':
    '安装完成后如仍提示未检测到，请确认 java 在 PATH 中，或设置 JAVA_HOME 指向 JDK/JRE 安装目录。',
  'java.recheck': '重新检测',
  'java.checking': '检测中…',
  'java.later': '稍后再说',
} as const;
