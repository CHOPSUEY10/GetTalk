<script>
    import gettalkLogo from "../assets/gettalk.svg";
    import iconHeaderShield from "../assets/landing/7d30c.svg";
    import iconCtaLock from "../assets/landing/e9e93.svg";
    import iconCtaArrow from "../assets/landing/77060.svg";
    import iconCtaLogin from "../assets/landing/406b4.svg";
    import iconPeerVerified from "../assets/landing/af3ae.svg";
    import iconMockupQr from "../assets/landing/67402.svg";
    import iconMockupLock from "../assets/landing/2cd1d.svg";
    import iconAttachmentClip from "../assets/landing/575a6.svg";
    import iconAttachmentCheck from "../assets/landing/dc680.svg";
    import imgMockupInputBar from "../assets/landing/7d176.svg";
    import iconWebCrypto from "../assets/landing/841e5.svg";
    import iconDoubleRatchet from "../assets/landing/089c3.svg";
    import iconSafetyNumber from "../assets/landing/9a777.svg";
    import iconSectionBadge from "../assets/landing/c226c.svg";
    import iconFeatureFile from "../assets/landing/1c322.svg";
    import iconPdfDoc from "../assets/landing/624b7.svg";
    import iconCheckCircle from "../assets/landing/72fa9.svg";
    import iconFeatureTimer from "../assets/landing/3e719.svg";
    import iconFlameTimer from "../assets/landing/ae421.svg";
    import iconClockSmall from "../assets/landing/b68a2.svg";
    import iconFeaturePrivacy from "../assets/landing/574c4.svg";
    import iconToggleOff from "../assets/landing/7a32b.svg";
    import iconFeatureDeviceAlert from "../assets/landing/99292.svg";
    import iconWarningTriangle from "../assets/landing/72b18.svg";
    import iconMiniQr from "../assets/landing/6deae.svg";
    import iconMiniMfa from "../assets/landing/959e8.svg";
    import iconMiniSpeed from "../assets/landing/54392.svg";
    import iconMiniHostShield from "../assets/landing/ddda0.svg";
    import iconBannerBadge from "../assets/landing/21c75.svg";
    import iconBannerBolt from "../assets/landing/7c52f.svg";
    import iconBannerShield from "../assets/landing/8e1f5.svg";

    let advisoryEmail = "";
    let advisorySubscribed = false;

    const handleAdvisorySubmit = () => {
        if (!advisoryEmail.trim()) return;
        advisorySubscribed = true;
        advisoryEmail = "";
    };

    const scrollToSpecs = (event) => {
        event.preventDefault();
        const el = document.getElementById("security-specs");
        if (el) {
            el.scrollIntoView({ behavior: "smooth" });
        }
    };
</script>

<div
    class="min-h-screen w-full flex flex-col bg-[#f8fafc] text-[#131b2e] selection:bg-indigo-600 selection:text-white overflow-x-hidden"
    data-node-id="1:2"
>
    <!-- Sticky Header Navigation (1:321) -->
    <header
        class="sticky top-0 z-40 w-full backdrop-blur-[24px] bg-white/90 border-b border-[#e2e8f0] shadow-[0px_1px_8px_0px_rgba(0,0,0,0.04)]"
        data-node-id="1:321"
    >
        <div
            class="max-w-[1280px] w-full mx-auto px-3 sm:px-[14px] py-2.5 sm:py-[13px] flex items-center justify-between gap-2 sm:gap-4"
            data-node-id="1:322"
        >
            <!-- Brand Link (1:323) -->
            <a
                href="#/"
                class="flex items-center gap-2 sm:gap-[10px] no-underline group min-w-0 shrink-0"
                data-node-id="1:323"
                aria-label="GetTalk Beranda"
            >
                <img
                    src={gettalkLogo}
                    alt="GetTalk Logo"
                    class="w-[34px] h-[34px] sm:w-[47.045px] sm:h-[46px] object-contain shrink-0 block"
                    data-node-id="3:56"
                />
                <div class="flex flex-col items-start min-w-0" data-node-id="1:325">
                    <span
                        class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[17px] sm:text-[20px] tracking-[-0.45px] leading-[18px] whitespace-nowrap"
                        data-node-id="1:327"
                    >
                        GetTalk
                    </span>
                    <span
                        class="hidden md:block font-mono font-extrabold text-[9px] text-[rgba(53,37,205,0.59)] tracking-[0.5px] uppercase leading-[18px] pt-[2px]"
                        data-node-id="1:330"
                    >
                        secure chat with end-to-end encryption
                    </span>
                </div>
            </a>

            <!-- Navigation Actions (1:331) -->
            <div class="flex items-center gap-1.5 sm:gap-[16px] shrink-0" data-node-id="1:331">
                <a
                    href="#/login"
                    class="px-2.5 sm:px-[12px] py-2 font-sans font-semibold text-[#131b2e] hover:text-[#4f46e5] text-[13px] sm:text-[14px] tracking-[0.14px] leading-[20px] whitespace-nowrap no-underline transition-colors"
                    data-node-id="1:332"
                >
                    Masuk
                </a>
                <a
                    href="#/register"
                    class="bg-[#4f46e5] hover:bg-[#4338ca] text-white font-sans font-semibold text-[13px] sm:text-[14px] tracking-[0.14px] leading-[20px] px-3 sm:px-[16px] py-2 sm:py-[10px] rounded-[8px] shadow-[0px_10px_15px_-3px_rgba(79,70,229,0.25)] whitespace-nowrap no-underline transition-all"
                    data-node-id="1:334"
                >
                    <span class="sm:hidden">Mulai Chat</span>
                    <span class="hidden sm:inline">Mulai Chat Terenkripsi</span>
                </a>
                <div
                    class="hidden sm:flex bg-[#eaedff] border border-[#e2e8f0] rounded-full size-[32px] items-center justify-center shrink-0"
                    data-node-id="1:337"
                    title="End-to-End Encrypted"
                >
                    <img src={iconHeaderShield} alt="" class="block shrink-0" />
                </div>
            </div>
        </div>
    </header>

    <!-- Main Content (1:3) -->
    <main class="flex-1 w-full flex flex-col" data-node-id="1:3">
        <!-- SECTION 1: HERO SECTION (1:34) -->
        <section
            class="relative w-full overflow-hidden pt-[48px] sm:pt-[64px] pb-[72px] sm:pb-[112px] px-[14.5px]"
            data-node-id="1:34"
        >
            <!-- Background Gradients & Blur Overlays -->
            <div
                class="absolute inset-0 bg-gradient-to-b from-[#f1f4fd] via-[#f8fafc] to-white pointer-events-none"
                data-node-id="1:37"
            ></div>
            <div
                class="-translate-x-1/2 absolute bg-[rgba(79,70,229,0.1)] blur-[64px] h-[450px] left-1/2 rounded-full top-0 w-[800px] pointer-events-none"
                data-node-id="1:35"
            ></div>
            <div
                class="absolute bg-[rgba(78,222,163,0.2)] blur-[64px] left-[40px] rounded-full size-[288px] top-[192px] pointer-events-none"
                data-node-id="1:36"
            ></div>

            <div
                class="relative z-10 max-w-[1280px] w-full mx-auto px-[16px] sm:px-[32px] flex flex-col items-center"
                data-node-id="1:38"
            >
                <div class="h-[24px] sm:h-[60px] w-[44px]" data-node-id="1:39"></div>

                <!-- Headline (1:42) -->
                <h1
                    class="max-w-[896px] font-['Plus_Jakarta_Sans',sans-serif] font-extrabold text-[#131b2e] text-[34px] sm:text-[44px] lg:text-[52px] text-center tracking-[-1.56px] leading-[1.15] lg:leading-[60px] m-0"
                    data-node-id="1:42"
                >
                    <span>Aplikasi Chat Real-Time dengan </span>
                    <span
                        class="bg-clip-text text-transparent bg-gradient-to-r from-[#3525cd] to-[#6063ee]"
                    >
                        End-to-End Encryption (E2EE)
                    </span>
                </h1>

                <!-- Subheadline (1:44) -->
                <div class="max-w-[768px] pt-[22.8px] text-center" data-node-id="1:44">
                    <p
                        class="font-sans font-normal text-[#64748b] text-[15px] sm:text-[17px] leading-[27.63px] m-0"
                        data-node-id="1:46"
                    >
                        GetTalk menjamin kerahasiaan komunikasi absolut melalui enkripsi per-pesan.
                        Server hanya merutekan sandi acak.
                    </p>
                </div>

                <!-- Dual Call to Action (1:47) -->
                <div
                    class="pt-[40px] flex flex-wrap items-center justify-center gap-[16px]"
                    data-node-id="1:47"
                >
                    <a
                        href="#/register"
                        class="bg-gradient-to-r from-[#4f46e5] to-[#6063ee] hover:opacity-95 flex items-center justify-center gap-[8px] px-[32px] py-[16px] rounded-[12px] shadow-[0px_20px_25px_-5px_rgba(79,70,229,0.25),0px_8px_10px_-6px_rgba(79,70,229,0.25)] font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-[18px] text-white tracking-[-0.18px] leading-[26px] no-underline transition-all"
                        data-node-id="1:49"
                    >
                        <img src={iconCtaLock} alt="" class="block shrink-0" />
                        <span>Daftarkan Akun</span>
                        <img src={iconCtaArrow} alt="" class="block shrink-0" />
                    </a>

                    <a
                        href="#/login"
                        class="bg-white hover:bg-slate-50 border border-[#e2e8f0] shadow-[0px_1px_1px_rgba(0,0,0,0.05)] flex items-center justify-center gap-[8px] px-[33px] py-[17px] rounded-[12px] font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-[18px] text-[#131b2e] tracking-[-0.18px] leading-[26px] no-underline transition-all"
                        data-node-id="1:57"
                    >
                        <img src={iconCtaLogin} alt="" class="block shrink-0" />
                        <span>Masuk ke Akun</span>
                    </a>
                </div>

                <!-- Visual Hero: Live Chat Mockup (1:62) -->
                <div
                    class="pt-[56px] sm:pt-[64px] w-full max-w-[679px]"
                    data-node-id="1:62"
                >
                    <div
                        class="bg-[#283044] border border-white/10 rounded-[16px] px-[12px] sm:px-[20px] pt-[22px] pb-[20px] shadow-2xl"
                        data-node-id="1:65"
                    >
                        <div
                            class="bg-black/40 border border-white/10 rounded-[12px] min-h-[380px] sm:h-[407px] flex flex-col justify-between overflow-hidden relative"
                            data-node-id="3:5"
                        >
                            <div>
                                <!-- Mockup Top Bar (1:83) -->
                                <div
                                    class="backdrop-blur-[12px] bg-white/5 border-b border-white/10 rounded-t-[8px] px-[12px] sm:px-[16px] py-[18px] flex items-center justify-between gap-3"
                                    data-node-id="1:83"
                                >
                                    <div class="flex items-center gap-[10px] min-w-0" data-node-id="1:84">
                                        <div class="relative size-[36px] shrink-0" data-node-id="1:85">
                                            <div
                                                class="bg-[#4f46e5] size-[36px] rounded-full shadow-[0px_0px_0px_2px_rgba(53,37,205,0.4)] flex items-center justify-center font-sans font-bold text-[14px] text-white"
                                                data-node-id="1:86"
                                            >
                                                FA
                                            </div>
                                            <span
                                                class="absolute bottom-0 right-0 bg-[#34d399] border-2 border-[#283044] rounded-full size-[10px]"
                                                data-node-id="1:89"
                                            ></span>
                                        </div>
                                        <div class="min-w-0" data-node-id="1:90">
                                            <div class="flex items-center gap-[6px]" data-node-id="1:91">
                                                <span
                                                    class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#faf8ff] text-[14px] leading-[20px] truncate"
                                                    data-node-id="1:93"
                                                >
                                                    Fauzan Ahsan
                                                </span>
                                                <img
                                                    src={iconPeerVerified}
                                                    alt="Terverifikasi"
                                                    class="block shrink-0"
                                                />
                                            </div>
                                            <p
                                                class="font-mono text-[11px] text-[#64748b] leading-[16.5px] m-0 truncate"
                                                data-node-id="1:97"
                                            >
                                                <span>Safety # 8941 0244 5519 3201 • </span>
                                                <span class="font-semibold text-[#4edea3]">Terverifikasi</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div class="flex items-center gap-[8px] shrink-0" data-node-id="1:98">
                                        <img src={iconMockupQr} alt="" class="block shrink-0" />
                                        <img src={iconMockupLock} alt="" class="block shrink-0" />
                                    </div>
                                </div>

                                <!-- Encrypted Incoming Message Bubble (1:104) -->
                                <div class="px-[16.5px] pt-[12px]">
                                    <div
                                        class="backdrop-blur-[12px] bg-white/10 border border-white/10 rounded-tl-[2px] rounded-tr-[16px] rounded-br-[16px] rounded-bl-[16px] p-[12px] max-w-[449px]"
                                        data-node-id="1:104"
                                    >
                                        <p
                                            class="font-sans text-[#faf8ff] text-[13px] leading-[20px] m-0 mb-[10px]"
                                            data-node-id="1:105"
                                        >
                                            Halo! Dokumen kontrak kerja rahasia sudah saya kirim dengan aman.
                                        </p>

                                        <!-- Attachment Preview Box (1:106) -->
                                        <div
                                            class="bg-black/30 border border-white/10 rounded-[8px] p-[8px] flex items-center justify-between gap-[10px] max-w-[244.188px]"
                                            data-node-id="1:106"
                                        >
                                            <div class="flex items-center gap-[10px] min-w-0">
                                                <div
                                                    class="bg-[rgba(79,70,229,0.2)] rounded-[4px] size-[32px] flex items-center justify-center shrink-0"
                                                    data-node-id="1:107"
                                                >
                                                    <img
                                                        src={iconAttachmentClip}
                                                        alt=""
                                                        class="block shrink-0"
                                                    />
                                                </div>
                                                <div class="min-w-0" data-node-id="1:110">
                                                    <p
                                                        class="font-mono font-semibold text-[#faf8ff] text-[12px] leading-[16px] m-0 truncate"
                                                        data-node-id="1:112"
                                                    >
                                                        dokumen-rahasia.pdf
                                                    </p>
                                                    <p
                                                        class="font-mono text-[#64748b] text-[10px] leading-[15px] m-0 truncate"
                                                        data-node-id="1:114"
                                                    >
                                                        Terkunci otomatis • 18.4 MB
                                                    </p>
                                                </div>
                                            </div>
                                            <img
                                                src={iconAttachmentCheck}
                                                alt=""
                                                class="block shrink-0"
                                            />
                                        </div>
                                    </div>

                                    <div class="pt-[5px] pl-[15px]" data-node-id="1:117">
                                        <span
                                            class="font-mono text-[#64748b] text-[10px] leading-[15px]"
                                            data-node-id="1:118"
                                        >
                                            10:42 • Pesan Terkunci Aman
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <!-- Mockup Bottom Input Bar (3:25) -->
                            <div
                                class="flex h-[61px] items-center justify-center w-full overflow-hidden"
                                data-node-id="3:25"
                            >
                                <div class="-rotate-90 flex-none">
                                    <div class="h-[629px] relative w-[61px]">
                                        <img
                                            src={imgMockupInputBar}
                                            alt=""
                                            class="block"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- SECTION 2: STRIP KEAMANAN & KRIPTOGRAFI TINGKAT ENTERPRISE (1:5) -->
        <section
            id="security-specs"
            class="bg-white border-y border-[#e2e8f0] py-[41px] px-[14.5px] w-full"
            data-node-id="1:5"
        >
            <div
                class="max-w-[1280px] w-full mx-auto px-[16px] sm:px-[32px] flex flex-col items-center gap-[24px]"
                data-node-id="1:6"
            >
                <p
                    class="font-mono font-normal text-[#64748b] text-[12px] text-center tracking-[1.2px] uppercase leading-[16px] m-0"
                    data-node-id="1:8"
                >
                    STANDAR KRIPTOGRAFI KLIEN &amp; PROTOKOL PERTAHANAN HOST
                </p>

                <div
                    class="flex flex-wrap items-center justify-center md:justify-between gap-[16px] w-full max-w-[896px]"
                    data-node-id="1:9"
                >
                    <!-- Spec 1: Web Crypto API (1:10) -->
                    <div
                        class="bg-[#f1f4fd] border border-[#e2e8f0] rounded-[12px] min-w-[220px] px-[24.7px] py-[13px] flex items-center justify-center gap-[10px]"
                        data-node-id="1:10"
                    >
                        <img src={iconWebCrypto} alt="" class="block shrink-0" />
                        <div class="flex flex-col items-start">
                            <span
                                class="font-mono font-bold text-[#131b2e] text-[12px] leading-[16px]"
                                data-node-id="1:15"
                            >
                                Web Crypto API
                            </span>
                            <span
                                class="font-mono font-normal text-[#64748b] text-[11px] leading-[16.5px]"
                                data-node-id="1:17"
                            >
                                Kunci Privat di Klien
                            </span>
                        </div>
                    </div>

                    <!-- Spec 2: Double Ratchet (1:18) -->
                    <div
                        class="bg-[#f1f4fd] border border-[#e2e8f0] rounded-[12px] min-w-[220px] px-[18.1px] py-[13px] flex items-center justify-center gap-[10px]"
                        data-node-id="1:18"
                    >
                        <img src={iconDoubleRatchet} alt="" class="block shrink-0" />
                        <div class="flex flex-col items-start">
                            <span
                                class="font-mono font-bold text-[#131b2e] text-[12px] leading-[16px]"
                                data-node-id="1:23"
                            >
                                Double Ratchet
                            </span>
                            <span
                                class="font-mono font-normal text-[#64748b] text-[11px] leading-[16.5px]"
                                data-node-id="1:25"
                            >
                                Perfect Forward Secrecy
                            </span>
                        </div>
                    </div>

                    <!-- Spec 3: Safety Number (1:26) -->
                    <div
                        class="bg-[#f1f4fd] border border-[#e2e8f0] rounded-[12px] min-w-[220px] px-[34.6px] py-[13px] flex items-center justify-center gap-[10px]"
                        data-node-id="1:26"
                    >
                        <img src={iconSafetyNumber} alt="" class="block shrink-0" />
                        <div class="flex flex-col items-start">
                            <span
                                class="font-mono font-bold text-[#131b2e] text-[12px] leading-[16px]"
                                data-node-id="1:31"
                            >
                                Safety Number
                            </span>
                            <span
                                class="font-mono font-normal text-[#64748b] text-[11px] leading-[16.5px]"
                                data-node-id="1:33"
                            >
                                Out-of-Band Verify
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- SECTION 3: 8 PILAR FITUR UTAMA (1:119) -->
        <section
            class="bg-[#f8fafc] pt-[72px] sm:pt-[112px] pb-[68px] px-[14.5px] w-full"
            data-node-id="1:119"
        >
            <div
                class="max-w-[1280px] w-full mx-auto px-[16px] sm:px-[32px] flex flex-col items-center gap-[32px]"
                data-node-id="1:120"
            >
                <!-- Section Header (1:121) -->
                <div
                    class="flex flex-col items-center gap-[12px] max-w-[768px]"
                    data-node-id="1:121"
                >
                    <div
                        class="bg-[#eaedff] rounded-full px-[14px] py-[6px] flex items-center gap-[8px]"
                        data-node-id="1:122"
                    >
                        <img src={iconSectionBadge} alt="" class="block shrink-0" />
                        <span
                            class="font-mono font-bold text-[#3525cd] text-[12px] tracking-[0.6px] uppercase leading-[16px]"
                            data-node-id="1:124"
                        >
                            PENGALAMAN NYATA SETIAP HARI
                        </span>
                    </div>

                    <h2
                        class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[28px] sm:text-[38px] text-center tracking-[-0.76px] leading-[1.2] sm:leading-[46px] m-0"
                        data-node-id="1:125"
                    >
                        Mengedepankan Privasi dan Keamanan Pengguna
                    </h2>
                </div>

                <!-- 2x2 Primary Features Grid (1:127) -->
                <div
                    class="grid grid-cols-1 lg:grid-cols-2 gap-[24px] pt-[16px] sm:pt-[32px] w-full"
                    data-node-id="1:127"
                >
                    <!-- Card 1: Kirim Foto & Dokumen Jumbo (1:128) -->
                    <article
                        class="bg-white border border-[#e2e8f0] rounded-[24px] p-[24px] sm:p-[33px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex flex-col justify-between"
                        data-node-id="1:128"
                    >
                        <div>
                            <div
                                class="flex items-center justify-between gap-2 pb-[16px]"
                                data-node-id="1:130"
                            >
                                <div
                                    class="bg-[#ecfdf5] rounded-[16px] size-[48px] flex items-center justify-center shrink-0"
                                    data-node-id="1:131"
                                >
                                    <img src={iconFeatureFile} alt="" class="block shrink-0" />
                                </div>
                                <span
                                    class="bg-[#ecfdf5] px-[12px] py-[4px] rounded-full font-mono font-bold text-[#005338] text-[12px] leading-[16px]"
                                    data-node-id="1:134"
                                >
                                    Tanpa Pecah • 25 MB
                                </span>
                            </div>

                            <div class="flex flex-col gap-[6.875px]" data-node-id="1:136">
                                <h3
                                    class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[22px] sm:text-[24px] tracking-[-0.36px] leading-[32px] m-0"
                                    data-node-id="1:138"
                                >
                                    Kirim Foto &amp; Dokumen Jumbo
                                </h3>
                                <p
                                    class="font-sans text-[#64748b] text-[15px] leading-[24.38px] m-0"
                                    data-node-id="1:140"
                                >
                                    Kirim foto resolusi asli, portofolio desain, atau dokumen PDF rahasia
                                    hingga 25 MB tanpa kompresi buram. File langsung dikunci di ponsel
                                    sebelum terkirim dan diunduh secepat kilat.
                                </p>
                            </div>
                        </div>

                        <div class="pt-[24px] w-full" data-node-id="1:141">
                            <div
                                class="bg-[#f1f4fd] border border-[#e2e8f0] rounded-[16px] p-[15px] flex flex-col gap-[8px] w-full"
                                data-node-id="1:142"
                            >
                                <div class="flex items-center justify-between gap-2" data-node-id="1:143">
                                    <div class="flex items-center gap-[10px] min-w-0" data-node-id="1:144">
                                        <div
                                            class="bg-[#005338] rounded-[8px] size-[32px] flex items-center justify-center shrink-0"
                                            data-node-id="1:145"
                                        >
                                            <img src={iconPdfDoc} alt="" class="block shrink-0" />
                                        </div>
                                        <div class="min-w-0" data-node-id="1:148">
                                            <p
                                                class="font-mono font-bold text-[#131b2e] text-[12px] leading-[16px] m-0 truncate"
                                                data-node-id="1:150"
                                            >
                                                Laporan_Keuangan_Q1_Final.pdf
                                            </p>
                                            <p
                                                class="font-mono text-[#64748b] text-[11px] leading-[16.5px] m-0 truncate"
                                                data-node-id="1:152"
                                            >
                                                24.8 MB • Enkripsi Klien Selesai
                                            </p>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-[4px] shrink-0" data-node-id="1:153">
                                        <img src={iconCheckCircle} alt="" class="block shrink-0" />
                                        <span
                                            class="font-mono font-bold text-[#005338] text-[12px] leading-[16px]"
                                            data-node-id="1:156"
                                        >
                                            100%
                                        </span>
                                    </div>
                                </div>
                                <div
                                    class="bg-[#e2e8f0] h-[6px] rounded-full w-full overflow-hidden"
                                    data-node-id="1:157"
                                >
                                    <div
                                        class="bg-[#005338] h-full w-full rounded-full"
                                        data-node-id="1:158"
                                    ></div>
                                </div>
                            </div>
                        </div>
                    </article>

                    <!-- Card 2: Hapus & Bersihkan Obrolan Dua Arah (1:159) -->
                    <article
                        class="bg-white border border-[#e2e8f0] rounded-[24px] p-[24px] sm:p-[33px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex flex-col justify-between"
                        data-node-id="1:159"
                    >
                        <div>
                            <div
                                class="flex items-center justify-between gap-2 pb-[16px]"
                                data-node-id="1:161"
                            >
                                <div
                                    class="bg-[#eaedff] rounded-[16px] size-[48px] flex items-center justify-center shrink-0"
                                    data-node-id="1:162"
                                >
                                    <img src={iconFeatureTimer} alt="" class="block shrink-0" />
                                </div>
                                <span
                                    class="bg-[#eaedff] px-[12px] py-[4px] rounded-full font-mono font-bold text-[#3525cd] text-[12px] leading-[16px]"
                                    data-node-id="1:165"
                                >
                                    Kendali Obrolan
                                </span>
                            </div>

                            <div class="flex flex-col gap-[6.875px]" data-node-id="1:167">
                                <h3
                                    class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[22px] sm:text-[24px] tracking-[-0.36px] leading-[32px] m-0"
                                    data-node-id="1:169"
                                >
                                    Edit Pesan &amp; Bersihkan Obrolan Dua Arah
                                </h3>
                                <p
                                    class="font-sans text-[#64748b] text-[15px] leading-[24.38px] m-0"
                                    data-node-id="1:171"
                                >
                                    Salah ketik atau ingin membersihkan riwayat obrolan penting? Edit
                                    pesan kapan saja, hapus pesan tertentu, atau bersihkan seluruh isi
                                    percakapan sekaligus di layar Anda maupun lawan bicara.
                                </p>
                            </div>
                        </div>

                        <div class="pt-[24px] w-full" data-node-id="1:172">
                            <div
                                class="bg-[#f1f4fd] border border-[#e2e8f0] rounded-[16px] p-[15px] flex items-center justify-between gap-3 w-full"
                                data-node-id="1:173"
                            >
                                <div class="flex items-center gap-[10px] min-w-0" data-node-id="1:174">
                                    <img src={iconFlameTimer} alt="" class="block shrink-0" />
                                    <div class="min-w-0" data-node-id="1:177">
                                        <p
                                            class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[12px] leading-[16px] m-0 truncate"
                                            data-node-id="1:179"
                                        >
                                            Bersihkan Percakapan Dua Arah
                                        </p>
                                        <p
                                            class="font-mono text-[#64748b] text-[11px] leading-[16.5px] m-0 truncate"
                                            data-node-id="1:181"
                                        >
                                            Riwayat obrolan dihapus untuk kedua belah pihak
                                        </p>
                                    </div>
                                </div>

                                <div
                                    class="bg-white border border-[#e2e8f0] rounded-[12px] px-[13px] py-[7px] flex items-center gap-[6px] shrink-0"
                                    data-node-id="1:182"
                                >
                                    <img src={iconClockSmall} alt="" class="block shrink-0" />
                                    <span
                                        class="font-mono font-bold text-[#3525cd] text-[12px] leading-[16px]"
                                        data-node-id="1:186"
                                    >
                                        Instan
                                    </span>
                                </div>
                            </div>
                        </div>
                    </article>

                    <!-- Card 3: Kendali Privasi Total & Senyap (1:187) -->
                    <article
                        class="bg-white border border-[#e2e8f0] rounded-[24px] p-[24px] sm:p-[33px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex flex-col justify-between"
                        data-node-id="1:187"
                    >
                        <div>
                            <div
                                class="flex items-center justify-between gap-2 pb-[16px]"
                                data-node-id="1:189"
                            >
                                <div
                                    class="bg-[#e1e0ff] rounded-[16px] size-[48px] flex items-center justify-center shrink-0"
                                    data-node-id="1:190"
                                >
                                    <img src={iconFeaturePrivacy} alt="" class="block shrink-0" />
                                </div>
                                <span
                                    class="bg-[#e1e0ff] px-[12px] py-[4px] rounded-full font-mono font-bold text-[#4648d4] text-[12px] leading-[16px]"
                                    data-node-id="1:193"
                                >
                                    Bebas Intip
                                </span>
                            </div>

                            <div class="flex flex-col gap-[6.875px]" data-node-id="1:195">
                                <h3
                                    class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[22px] sm:text-[24px] tracking-[-0.36px] leading-[32px] m-0"
                                    data-node-id="1:197"
                                >
                                    Kendali Privasi Total &amp; Senyap
                                </h3>
                                <p
                                    class="font-sans text-[#64748b] text-[15px] leading-[24.38px] m-0"
                                    data-node-id="1:199"
                                >
                                    Anda penentu segalanya: matikan tanda centang baca (read receipt),
                                    sembunyikan status online maupun kapan terakhir aktif, serta hilangkan
                                    penanda mengetik (typing indicator) tanpa cemas.
                                </p>
                            </div>
                        </div>

                        <div class="pt-[24px] w-full" data-node-id="1:200">
                            <div
                                class="grid grid-cols-1 sm:grid-cols-3 gap-[8px] w-full"
                                data-node-id="1:201"
                            >
                                <div
                                    class="bg-[#f1f4fd] border border-[#e2e8f0] rounded-[12px] p-[11px] flex items-center justify-between gap-2"
                                    data-node-id="1:202"
                                >
                                    <span
                                        class="font-mono font-bold text-[#334155] text-[11px] leading-[16.5px]"
                                        data-node-id="1:204"
                                    >
                                        Centang Biru
                                    </span>
                                    <img src={iconToggleOff} alt="" class="block shrink-0" />
                                </div>
                                <div
                                    class="bg-[#f1f4fd] border border-[#e2e8f0] rounded-[12px] p-[11px] flex items-center justify-between gap-2"
                                    data-node-id="1:207"
                                >
                                    <span
                                        class="font-mono font-bold text-[#334155] text-[11px] leading-[16.5px]"
                                        data-node-id="1:209"
                                    >
                                        Status Online
                                    </span>
                                    <img src={iconToggleOff} alt="" class="block shrink-0" />
                                </div>
                                <div
                                    class="bg-[#f1f4fd] border border-[#e2e8f0] rounded-[12px] p-[11px] flex items-center justify-between gap-2"
                                    data-node-id="1:212"
                                >
                                    <span
                                        class="font-mono font-bold text-[#334155] text-[11px] leading-[16.5px]"
                                        data-node-id="1:214"
                                    >
                                        Mengetik...
                                    </span>
                                    <img src={iconToggleOff} alt="" class="block shrink-0" />
                                </div>
                            </div>
                        </div>
                    </article>

                    <!-- Card 4: Peringatan Otomatis Jika Teman Ganti Device (1:217) -->
                    <article
                        class="bg-white border border-[#e2e8f0] rounded-[24px] p-[24px] sm:p-[33px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex flex-col justify-between"
                        data-node-id="1:217"
                    >
                        <div>
                            <div
                                class="flex items-center justify-between gap-2 pb-[16px]"
                                data-node-id="1:219"
                            >
                                <div
                                    class="bg-[rgba(255,218,214,0.4)] rounded-[16px] size-[48px] flex items-center justify-center shrink-0"
                                    data-node-id="1:220"
                                >
                                    <img src={iconFeatureDeviceAlert} alt="" class="block shrink-0" />
                                </div>
                                <span
                                    class="bg-[rgba(255,218,214,0.4)] px-[12px] py-[4px] rounded-full font-mono font-bold text-[#ba1a1a] text-[12px] leading-[16px]"
                                    data-node-id="1:223"
                                >
                                    Proteksi Identitas
                                </span>
                            </div>

                            <div class="flex flex-col gap-[6.875px]" data-node-id="1:225">
                                <h3
                                    class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[22px] sm:text-[24px] tracking-[-0.36px] leading-[32px] m-0"
                                    data-node-id="1:227"
                                >
                                    Peringatan Otomatis Jika Teman Ganti Device
                                </h3>
                                <p
                                    class="font-sans text-[#64748b] text-[15px] leading-[24.38px] m-0"
                                    data-node-id="1:229"
                                >
                                    Bebas dari penipuan bajak akun! Jika lawan bicara berpindah ke
                                    perangkat baru atau ganti ponsel, GetTalk langsung memberi notifikasi
                                    peringatan sebelum pesan baru Anda kirimkan.
                                </p>
                            </div>
                        </div>

                        <div class="pt-[24px] w-full" data-node-id="1:230">
                            <div
                                class="bg-[rgba(255,218,214,0.4)] border border-[rgba(186,26,26,0.2)] rounded-[16px] p-[13px] flex items-center gap-[12px] w-full"
                                data-node-id="1:231"
                            >
                                <img src={iconWarningTriangle} alt="" class="block shrink-0" />
                                <p
                                    class="font-mono text-[#93000a] text-[12px] leading-[19.5px] m-0"
                                    data-node-id="1:235"
                                >
                                    <strong class="font-bold">Identitas Kunci Berubah:</strong>
                                    <span>
                                        Lawan bicara masuk dari perangkat baru. Klik verifikasi sebelum
                                        melanjutkan percakapan.
                                    </span>
                                </p>
                            </div>
                        </div>
                    </article>
                </div>

                <!-- 4 Secondary Feature Mini-Cards Row (1:236) -->
                <div
                    class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px] w-full"
                    data-node-id="1:236"
                >
                    <!-- Mini-Card 1: Verifikasi QR Kontak (1:237) -->
                    <div
                        class="bg-white border border-[#e2e8f0] rounded-[16px] p-[21px] flex items-start gap-[14px]"
                        data-node-id="1:237"
                    >
                        <div
                            class="bg-[#eaedff] rounded-[12px] size-[40px] flex items-center justify-center shrink-0"
                            data-node-id="1:238"
                        >
                            <img src={iconMiniQr} alt="" class="block shrink-0" />
                        </div>
                        <div class="flex flex-col gap-[4px]" data-node-id="1:241">
                            <h4
                                class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[14px] leading-[20px] m-0"
                                data-node-id="1:243"
                            >
                                Verifikasi QR Kontak
                            </h4>
                            <p
                                class="font-sans text-[#64748b] text-[12px] leading-[19.5px] m-0"
                                data-node-id="1:245"
                            >
                                Pindai kode QR visual langsung saat bertemu untuk memastikan kontak
                                100% otentik.
                            </p>
                        </div>
                    </div>

                    <!-- Mini-Card 2: Kunci Akun & MFA 2FA (1:246) -->
                    <div
                        class="bg-white border border-[#e2e8f0] rounded-[16px] p-[21px] flex items-start gap-[14px]"
                        data-node-id="1:246"
                    >
                        <div
                            class="bg-[#ecfdf5] rounded-[12px] size-[40px] flex items-center justify-center shrink-0"
                            data-node-id="1:247"
                        >
                            <img src={iconMiniMfa} alt="" class="block shrink-0" />
                        </div>
                        <div class="flex flex-col gap-[4px]" data-node-id="1:250">
                            <h4
                                class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[14px] leading-[20px] m-0"
                                data-node-id="1:252"
                            >
                                Kunci Akun &amp; MFA 2FA
                            </h4>
                            <p
                                class="font-sans text-[#64748b] text-[12px] leading-[19.5px] m-0"
                                data-node-id="1:254"
                            >
                                Otentikasi TOTP RFC 6238 dan otomatis kunci akun jika salah kata sandi
                                3 kali.
                            </p>
                        </div>
                    </div>

                    <!-- Mini-Card 3: Kelola Perangkat Aktif (1:255) -->
                    <div
                        class="bg-white border border-[#e2e8f0] rounded-[16px] p-[21px] flex items-start gap-[14px]"
                        data-node-id="1:255"
                    >
                        <div
                            class="bg-[#e1e0ff] rounded-[12px] size-[40px] flex items-center justify-center shrink-0"
                            data-node-id="1:256"
                        >
                            <img src={iconMiniSpeed} alt="" class="block shrink-0" />
                        </div>
                        <div class="flex flex-col gap-[4px]" data-node-id="1:259">
                            <h4
                                class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[14px] leading-[20px] m-0"
                                data-node-id="1:261"
                            >
                                Pantau Perangkat Aktif
                            </h4>
                            <p
                                class="font-sans text-[#64748b] text-[12px] leading-[19.5px] m-0"
                                data-node-id="1:263"
                            >
                                Lihat perangkat mana saja yang sedang masuk dan putuskan akses dari
                                jarak jauh kapan pun.
                            </p>
                        </div>
                    </div>

                    <!-- Mini-Card 4: Pelindung Host Senyap (1:264) -->
                    <div
                        class="bg-white border border-[#e2e8f0] rounded-[16px] p-[21px] flex items-start gap-[14px]"
                        data-node-id="1:264"
                    >
                        <div
                            class="bg-[#dae2fd] rounded-[12px] size-[40px] flex items-center justify-center shrink-0"
                            data-node-id="1:265"
                        >
                            <img src={iconMiniHostShield} alt="" class="block shrink-0" />
                        </div>
                        <div class="flex flex-col gap-[4px]" data-node-id="1:268">
                            <h4
                                class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[14px] leading-[20px] m-0"
                                data-node-id="1:270"
                            >
                                Pelindung Host Senyap
                            </h4>
                            <p
                                class="font-sans text-[#64748b] text-[12px] leading-[19.5px] m-0"
                                data-node-id="1:272"
                            >
                                Deteksi anomali server otomatis 24/7 tanpa sedikitpun melihat isi
                                obrolan Anda.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- SECTION 4: FINAL HIGH-IMPACT CTA BANNER (1:273) -->
        <section
            class="bg-[#f8fafc] pt-[40px] pb-[64px] px-[16px] sm:px-[46.5px] w-full"
            data-node-id="1:273"
        >
            <div
                class="max-w-[1216px] w-full mx-auto bg-gradient-to-r from-[#3525cd] to-[#4f46e5] rounded-[24px] p-[32px] sm:p-[56px] shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)] relative overflow-hidden flex flex-col lg:flex-row items-start lg:items-center justify-between gap-[32px] lg:gap-[64px]"
                data-node-id="1:274"
            >
                <div
                    class="absolute bg-[rgba(225,224,255,0.2)] blur-[64px] bottom-[-80.13px] right-[-80px] rounded-full size-[384px] pointer-events-none"
                    data-node-id="1:275"
                ></div>
                <div
                    class="absolute bg-[rgba(78,222,163,0.2)] blur-[40px] left-[40px] rounded-full size-[256px] top-[-40px] pointer-events-none"
                    data-node-id="1:276"
                ></div>

                <div
                    class="relative z-10 flex flex-col gap-[24px] sm:gap-[31px] items-start max-w-[672px]"
                    data-node-id="1:277"
                >
                    <div
                        class="bg-white/15 rounded-full px-[12px] py-[6px] flex items-center gap-[8px]"
                        data-node-id="1:278"
                    >
                        <img src={iconBannerBadge} alt="" class="block shrink-0" />
                        <span
                            class="font-mono font-bold text-[12px] text-white leading-[16px]"
                            data-node-id="1:280"
                        >
                            Open Cryptography • Zero Plaintext Guarantee
                        </span>
                    </div>

                    <h2
                        class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-white text-[28px] sm:text-[38px] tracking-[-0.76px] leading-[1.2] sm:leading-[46px] m-0"
                        data-node-id="1:281"
                    >
                        Mulai Obrolan Terenkripsi Penuh dengan GetTalk Hari Ini.
                    </h2>
                </div>

                <div
                    class="relative z-10 flex flex-wrap items-center gap-[12px] shrink-0"
                    data-node-id="1:285"
                >
                    <a
                        href="#/register"
                        class="bg-white hover:bg-slate-50 rounded-[12px] px-[28px] py-[14px] shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)] flex items-center justify-center gap-[8px] font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#3525cd] text-[14px] leading-[20px] no-underline transition-all"
                        data-node-id="1:286"
                    >
                        <img src={iconBannerBolt} alt="" class="block shrink-0" />
                        <span>Daftar Gratis Sekarang</span>
                    </a>

                    <a
                        href="#security-specs"
                        on:click={scrollToSpecs}
                        class="bg-white/10 hover:bg-white/20 border border-white/20 rounded-[12px] px-[29px] py-[15px] flex items-center justify-center gap-[8px] font-['Plus_Jakarta_Sans',sans-serif] font-semibold text-white text-[14px] leading-[20px] no-underline transition-all"
                        data-node-id="1:292"
                    >
                        <img src={iconBannerShield} alt="" class="block shrink-0" />
                        <span>Jelajahi Spesifikasi Keamanan</span>
                    </a>
                </div>
            </div>
        </section>
    </main>

    <!-- FOOTER (1:297 / 1:298) -->
    <footer
        class="bg-white border-t border-[#e2e8f0] w-full pt-[32px] pb-[28px] px-[16px] sm:px-[44px]"
        data-node-id="1:298"
    >
        <div class="max-w-[1218px] w-full mx-auto flex flex-col gap-[32px]">
            <div class="flex flex-col items-start gap-[12px]" data-node-id="1:301">
                <a
                    href="#/"
                    class="flex items-center gap-[10px] no-underline"
                    data-node-id="1:304"
                    aria-label="GetTalk Beranda"
                >
                    <img
                        src={gettalkLogo}
                        alt="GetTalk Logo"
                        class="w-[44.85px] h-[43.899px] object-contain shrink-0 block"
                        data-node-id="3:67"
                    />
                    <span
                        class="font-['Plus_Jakarta_Sans',sans-serif] font-bold text-[#131b2e] text-[28.42px] tracking-[-0.4567px] leading-[18.27px]"
                        data-node-id="1:306"
                    >
                        GetTalk
                    </span>
                </a>

                <p
                    class="font-sans text-[#64748b] text-[13.195px] leading-[20.3px] m-0"
                    data-node-id="1:311"
                >
                    Platform obrolan terenkripsi end-to-end dan autentikasi ganda
                </p>

                <form
                    on:submit|preventDefault={handleAdvisorySubmit}
                    class="flex flex-wrap items-center gap-[8px] pt-[4px] w-full max-w-[395px]"
                    data-node-id="1:312"
                >
                    <input
                        type="email"
                        bind:value={advisoryEmail}
                        placeholder="Email untuk security advisory"
                        aria-label="Email untuk security advisory"
                        class="bg-[#f1f4fd] border border-[#e2e8f0] rounded-[8.12px] px-[13.2px] py-[9.135px] w-full sm:w-[291.8px] font-mono text-[12.18px] text-[#131b2e] placeholder-[#64748b] focus:outline-none focus:ring-2 focus:ring-[#3525cd]"
                        data-node-id="1:313"
                    />
                    <button
                        type="submit"
                        class="bg-[#3525cd] hover:bg-[#2a1da8] text-white font-sans font-semibold text-[12.18px] leading-[16.24px] px-[14.21px] py-[9.135px] rounded-[8.12px] cursor-pointer transition-colors"
                        data-node-id="1:316"
                    >
                        Langganan
                    </button>
                </form>

                {#if advisorySubscribed}
                    <p class="font-mono text-[11px] text-[#005338] m-0">
                        Terima kasih! Email Anda telah terdaftar untuk menerima security advisory.
                    </p>
                {/if}
            </div>

            <div
                class="border-t border-[#e2e8f0] pt-4 sm:pt-[24px] flex items-center justify-center sm:justify-end"
                data-node-id="1:318"
            >
                <span
                    class="font-mono text-[#64748b] text-[11px] sm:text-[13px] md:text-[16.234px] leading-[1.2] sm:leading-[16.234px]"
                    data-node-id="1:320"
                >
                    © 2026 GetTalk Inc
                </span>
            </div>
        </div>
    </footer>
</div>
