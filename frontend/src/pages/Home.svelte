<script>
    import ProtectedLayout from "../components/layout/ProtectedLayout.svelte";
    import { authStore } from "../stores/auth.store.js";
    import { socketState } from "../lib/socket.js";
</script>

<ProtectedLayout>
    <div class="max-w-5xl mx-auto space-y-8">
        <!-- Welcome Hero Banner -->
        <div class="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white p-8 md:p-10 shadow-xl shadow-indigo-950/20">
            <div class="relative z-10 max-w-2xl">
                <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-xs font-medium text-indigo-200 mb-4">
                    <span class="w-2 h-2 rounded-full {$socketState.connected ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}"></span>
                    <span>{$socketState.connected ? 'Real-Time Socket Terhubung' : 'Menghubungkan Jaringan...'}</span>
                </div>
                <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight text-white mb-3">
                    Halo, {$authStore.user?.username || "Pengguna"}! 👋
                </h1>
                <p class="text-slate-300 text-base md:text-lg leading-relaxed mb-6">
                    Selamat datang di GetTalk. Semua pesan dan lampiran Anda dilindungi oleh enkripsi client-side end-to-end (E2EE) berstandar tinggi.
                </p>
                <div class="flex flex-wrap gap-3">
                    <a
                        href="#/friends"
                        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all shadow-md shadow-indigo-700/50"
                    >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        <span>Daftar Teman & Obrolan</span>
                    </a>
                </div>
            </div>

            <!-- Decorative background elements -->
            <div class="absolute -right-12 -bottom-12 w-64 h-64 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none"></div>
            <div class="absolute right-20 top-10 w-32 h-32 rounded-full bg-violet-500/15 blur-2xl pointer-events-none"></div>
        </div>

        <!-- Quick Feature Cards Grid -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Card 1: E2EE Security -->
            <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                <div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                </div>
                <h3 class="font-bold text-slate-900 text-base mb-1">Enkripsi End-to-End</h3>
                <p class="text-sm text-slate-500 leading-relaxed">
                    Kunci enkripsi berada di perangkat Anda (ECDH + AES-256-GCM). Server tidak dapat membaca isi pesan Anda.
                </p>
            </div>

            <!-- Card 2: Friends & Contacts -->
            <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                <div class="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                </div>
                <h3 class="font-bold text-slate-900 text-base mb-1">Manajemen Teman</h3>
                <p class="text-sm text-slate-500 leading-relaxed">
                    Kirim permintaan pertemanan dengan username dan bangun jaringan komunikasi pribadi Anda.
                </p>
            </div>

            <!-- Card 3: Real-Time Messaging -->
            <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                <div class="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mb-4">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                </div>
                <h3 class="font-bold text-slate-900 text-base mb-1">Pengiriman Instan</h3>
                <p class="text-sm text-slate-500 leading-relaxed">
                    Pengiriman pesan secepat kilat dengan Socket.IO dan sinkronisasi otomatis status tanda terima pesan.
                </p>
            </div>
        </div>

        <!-- Start Conversation CTA Container -->
        <div class="bg-white rounded-2xl border border-slate-200 p-8 text-center">
            <div class="max-w-md mx-auto">
                <div class="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4">
                    <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                </div>
                <h3 class="text-lg font-bold text-slate-900 mb-2">Siap Memulai Percakapan?</h3>
                <p class="text-sm text-slate-500 mb-6">
                    Pilih teman dari daftar kontak Anda untuk membuka ruang obrolan terenkripsi.
                </p>
                <a
                    href="#/friends"
                    class="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors shadow-md shadow-indigo-100"
                >
                    <span>Buka Daftar Teman</span>
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                </a>
            </div>
        </div>
    </div>
</ProtectedLayout>
