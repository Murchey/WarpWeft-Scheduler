#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
service_dir="$root_dir/services/solver-java"
lib_dir="$service_dir/lib"
source_dir="$service_dir/src/main/java"
build_dir="$service_dir/build"
classes_dir="$build_dir/classes"
fat_dir="$build_dir/fat"
dist_dir="$root_dir/resources/solver"
jar_path="$dist_dir/warpweft-solver.jar"
manifest="$build_dir/MANIFEST.MF"

find_tool() {
  local name="$1"
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/$name" ]; then
    printf '%s\n' "$JAVA_HOME/bin/$name"
  elif command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
  else
    return 1
  fi
}

javac_bin="$(find_tool javac || true)"
jar_bin="$(find_tool jar || true)"
if [ -z "$javac_bin" ] || [ -z "$jar_bin" ]; then
  echo "找不到 javac/jar。请安装 JDK 21，并设置 JAVA_HOME 或把 bin 目录加入 PATH。" >&2
  exit 1
fi

version_line="$("$javac_bin" -version 2>&1 | head -n 1)"
major="$(printf '%s\n' "$version_line" | awk '{print $2}' | cut -d. -f1)"
if ! [[ "$major" =~ ^[0-9]+$ ]] || [ "$major" -lt 21 ]; then
  echo "需要 JDK 21 或更高版本，当前：$version_line" >&2
  exit 1
fi

maven_mirror="${MAVEN_MIRROR:-https://repo.maven.apache.org/maven2}"
maven_mirror="${maven_mirror%/}"

download() {
  local url="$1"
  local target="$2"
  local tmp="$target.tmp"
  rm -f "$tmp"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$tmp"
  else
    echo "找不到 curl 或 wget，无法下载 Java 依赖。" >&2
    exit 1
  fi
  mv "$tmp" "$target"
}

mkdir -p "$lib_dir"
for spec in \
  "jackson-annotations-2.17.2.jar:com/fasterxml/jackson/core/jackson-annotations/2.17.2/jackson-annotations-2.17.2.jar" \
  "jackson-core-2.17.2.jar:com/fasterxml/jackson/core/jackson-core/2.17.2/jackson-core-2.17.2.jar" \
  "jackson-databind-2.17.2.jar:com/fasterxml/jackson/core/jackson-databind/2.17.2/jackson-databind-2.17.2.jar"; do
  name="${spec%%:*}"
  remote="${spec#*:}"
  target="$lib_dir/$name"
  if [ -s "$target" ]; then
    continue
  fi
  echo "下载依赖：$name"
  download "$maven_mirror/$remote" "$target"
done

rm -rf "$classes_dir" "$fat_dir"
mkdir -p "$classes_dir" "$fat_dir"
mapfile -t java_files < <(find "$source_dir" -type f -name '*.java' | sort)
if [ "${#java_files[@]}" -eq 0 ]; then
  echo "未找到 Java 源文件：$source_dir" >&2
  exit 1
fi

"$javac_bin" --release 21 -encoding UTF-8 -cp "$lib_dir/*" -d "$classes_dir" "${java_files[@]}"
cp -R "$classes_dir/." "$fat_dir/"

for dependency in "$lib_dir"/*.jar; do
  [ -f "$dependency" ] || continue
  (cd "$fat_dir" && "$jar_bin" xf "$dependency")
done

printf 'Manifest-Version: 1.0\nMain-Class: com.warpweft.solver.WarpWeftSolver\nMulti-Release: true\n\n' > "$manifest"
mkdir -p "$dist_dir"
rm -f "$jar_path"
"$jar_bin" --create --file "$jar_path" --manifest "$manifest" -C "$fat_dir" .
echo "Java solver built: $jar_path"
