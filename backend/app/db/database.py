from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
from pymongo.server_api import ServerApi
import os
from dotenv import load_dotenv

# ---------------- LOAD ENV ---------------- #

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
DB_NAME = os.getenv("DB_NAME", "niangao")

if not MONGO_URI:
    raise ValueError("❌ 缺少 MONGO_URI，请在 backend/.env 中配置数据库连接串")

# ---------------- DNS RESOLVER（可选） ---------------- #
# mongodb+srv:// 连接需要先查 SRV 记录。部分家用路由器/内网 DNS 不转发
# SRV 查询，报错形如 "The DNS operation timed out" 或 NXDOMAIN。
# 遇到这种情况，在 .env 里加一行即可绕开，不影响其他程序：
#     DNS_RESOLVERS=223.5.5.5
# 云端部署（DNS 正常）留空则不启用，线上行为不变。

DNS_RESOLVERS = os.getenv("DNS_RESOLVERS", "").strip()

if DNS_RESOLVERS:
    try:
        import dns.resolver as _dns

        _custom_resolver = _dns.Resolver(configure=False)
        _custom_resolver.nameservers = [
            s.strip() for s in DNS_RESOLVERS.split(",") if s.strip()
        ]
        _custom_resolver.lifetime = 15.0
        _dns.default_resolver = _custom_resolver
        print(f"✅ 使用自定义 DNS 解析器：{DNS_RESOLVERS}")
    except Exception as _e:
        print(f"⚠️ DNS 解析器配置失败，回退系统 DNS：{_e}")

# ---------------- CONNECTION ---------------- #

def create_client():
    is_atlas = "mongodb+srv://" in MONGO_URI

    return MongoClient(
        MONGO_URI,
        server_api=ServerApi("1") if is_atlas else None,
        serverSelectionTimeoutMS=10000,
        connectTimeoutMS=10000,
        maxPoolSize=50,
        retryWrites=True,
        tls=is_atlas  # ✅ only for Atlas
    )


try:
    client = create_client()
    client.admin.command("ping")
    print("✅ MongoDB connected")

except ConnectionFailure as e:
    print("❌ MongoDB connection failed:", str(e))
    raise

db = client[DB_NAME]

# ---------------- COLLECTIONS ---------------- #

users = db["users"]
chats = db["chats"]
blacklist = db["blacklist"]
sessions = db["sessions"]
assessments = db["assessments"]

# ---------------- INDEXES ---------------- #

def create_indexes():
    try:
        users.create_index("email", unique=True)

        chats.create_index("user")
        chats.create_index("created_at")

        blacklist.create_index("token", unique=True)
        blacklist.create_index(
            "created_at",
            expireAfterSeconds=86400  # auto-delete after 1 day
        )

        sessions.create_index("email", unique=True)

        assessments.create_index("user")
        assessments.create_index("created_at")

        print("✅ Indexes ensured")

    except Exception as e:
        print("❌ Index creation error:", str(e))


# ⚠️ Call this manually from startup, not on import