# -*- coding: utf-8 -*-
import io
p = "README.md"
s = io.open(p, encoding="utf-8").read()
if "5.0 一键跑通" not in s:
    block = """
### 5.0 一键跑通（推荐，评审用这个）

```bash
bash setup.sh     # 装 seekdb + 装 PowerContext + 建 scope + 导入工程资料
bash verify.sh    # 逐条验证 6 个必做项，最后打印 PASS/FAIL
```

预期输出末尾：

```
======== 结果：6 项通过，0 项失败 ========
全部通过 ✅
```

下面是等效的手工步骤（5.1~5.7），便于排查问题。

"""
    s = s.replace("## 5. 启动步骤\n", "## 5. 启动步骤\n" + block, 1)
    io.open(p, "w", encoding="utf-8").write(s)
    print("inserted")
else:
    print("already there")
