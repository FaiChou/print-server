// server.js

const express = require('express');
const multer = require('multer');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const fs = require('fs');

// --- 配置 ---
// 重要：请将 'HPRT_N41BT' 替换为你自己的打印机名称
const PRINTER_NAME = 'HPRT_N41BT';
const PORT = process.env.PORT || 3456; // 你可以修改为你想要的端口号

const DEFAULT_PRINT_SCALING = 'fit';
const PRINT_SCALING_ARGS = {
  fit: ['-o', 'print-scaling=fit'],
  'auto-fit': ['-o', 'print-scaling=auto-fit'],
  none: [] // 保持原有行为：不传额外 -o 参数
};

/**
 * 构建 lp 命令参数数组；若 printScaling 不在允许列表中则返回 null
 */
function buildLpArgs(printerName, filePath, printScaling = DEFAULT_PRINT_SCALING) {
  const scalingKey = (printScaling === undefined || printScaling === null || printScaling === '')
    ? DEFAULT_PRINT_SCALING
    : printScaling;

  if (!Object.prototype.hasOwnProperty.call(PRINT_SCALING_ARGS, scalingKey)) {
    return null;
  }

  return ['-d', printerName, ...PRINT_SCALING_ARGS[scalingKey], filePath];
}

// 初始化 Express 应用
const app = express();

// 使用 Express 内置的中间件来提供 public 目录下的静态文件（如 index.html）
app.use(express.static(path.join(__dirname, 'public')));
// 使用 Express 内置的中间件来解析 JSON 格式的请求体
app.use(express.json());

// 配置 multer 用于文件上传
// 将文件保存在操作系统的临时目录中（例如 /tmp）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 使用 os.tmpdir() 来确保跨平台的兼容性，在 Debian 上通常就是 /tmp
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    // 为了防止文件名冲突，我们在文件名前面加上时间戳
    // 同时对中文文件名进行编码处理，防止乱码问题
    const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniquePrefix + '-' + Buffer.from(file.originalname, 'latin1').toString('utf8'));
  }
});

const upload = multer({ storage: storage });

/**
 * API 端点：处理文件上传
 * 当文件上传后，multer 会自动将其保存在 /tmp 目录下
 * 然后我们返回文件的基本信息给前端
 */
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: '没有接收到文件' });
  }

  // 文件已由 multer 保存到 req.file.path
  console.log(`文件已上传并保存到: ${req.file.path}`);

  res.json({
    success: true,
    message: '文件上传成功',
    filename: req.file.filename, // 将保存在 /tmp 中的文件名返回给前端
    originalName: Buffer.from(req.file.originalname, 'latin1').toString('utf8')
  });
});

/**
 * API 端点：执行打印命令
 */
app.post('/print', (req, res) => {
  const { filename, printScaling } = req.body || {};

  if (!filename) {
    return res.status(400).json({ success: false, message: '缺少要打印的文件名' });
  }

  // 安全性：构建完整的文件路径，并确保它在 /tmp 目录内，防止路径遍历攻击
  const filePath = path.join(os.tmpdir(), path.basename(filename));
  const lpArgs = buildLpArgs(PRINTER_NAME, filePath, printScaling);

  if (!lpArgs) {
    return res.status(400).json({ success: false, message: '无效的打印缩放参数' });
  }

  // 再次确认文件是否存在
  if (!fs.existsSync(filePath)) {
    console.error(`尝试打印失败，文件不存在: ${filePath}`);
    return res.status(404).json({ success: false, message: '服务器上找不到该文件，可能已被清理' });
  }

  console.log(`正在执行打印命令: lp ${lpArgs.join(' ')}`);

  // 执行命令行
  execFile('lp', lpArgs, (error, stdout, stderr) => {
    if (error) {
      console.error(`打印命令执行错误: ${error.message}`);
      console.error(`stderr: ${stderr}`);
      return res.status(500).json({ success: false, message: `打印失败: ${stderr || error.message}` });
    }

    // 通常，lp 命令成功后 stdout 会包含请求 ID，例如 "request id is HPRT_N41BT-19 (1 file(s))"
    console.log(`打印命令输出: ${stdout}`);
    res.json({ success: true, message: `已发送到打印机！\n${stdout}` });
  });
});

// 启动服务器
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`打印服务器已启动，正在监听 http://0.0.0.0:${PORT}`);
    console.log(`请在局域网内其他设备上访问 http://<你的Debian设备IP>:${PORT}`);
  });
}

module.exports = { app, buildLpArgs, DEFAULT_PRINT_SCALING, PRINT_SCALING_ARGS };
