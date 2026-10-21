# Java dependencies

构建脚本会自动准备以下 Jackson 2.17.2 依赖，不需要提交 jar 文件：

- jackson-annotations-2.17.2.jar
- jackson-core-2.17.2.jar
- jackson-databind-2.17.2.jar

获取顺序：

1. 如果 lib/ 中已有对应 jar，直接使用
2. 否则尝试本机 Maven 缓存 ~/.m2/repository
3. 否则从 Maven Central 下载

如果离线构建，可以手动把三个 jar 放到本目录；它们已被 .gitignore 忽略。
