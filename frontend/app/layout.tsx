import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Chicago SafeRoute — AI-Powered Crime-Aware Navigation",
  description:
    "Navigate Chicago safely with real-time crime data and Gemini AI narration. Find the safest route between any two points.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-[#07080f] text-white antialiased">{children}</body>
    </html>
  );
}
