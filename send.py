"""الإرسال المجدول: python send.py morning | evening | friday"""
import sys

from tg import parse_targets, send_kind

kind = sys.argv[1] if len(sys.argv) > 1 else "morning"
targets = parse_targets()
if not targets:
    sys.exit("لا توجد وجهات: أضف المتغير TARGETS في إعدادات GitHub")

failed = 0
for dest in targets:
    try:
        send_kind(dest, kind)
    except Exception as e:  # فشل وجهة لا يوقف بقية الوجهات
        failed += 1
        print("فشل الإرسال إلى", dest[0], "-", e)

sys.exit(1 if failed else 0)
