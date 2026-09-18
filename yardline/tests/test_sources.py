import unittest

from yardline.sources import _pick_youtube_url, is_live_ref, source_id, youtube_id


class TestSources(unittest.TestCase):
    def test_youtube_id(self):
        self.assertEqual(youtube_id("https://www.youtube.com/watch?v=zMCea32gpmg"), "zMCea32gpmg")
        self.assertEqual(youtube_id("https://youtu.be/zMCea32gpmg"), "zMCea32gpmg")

    def test_live_refs(self):
        self.assertTrue(is_live_ref("webcam:0"))
        self.assertTrue(is_live_ref("https://www.youtube.com/watch?v=zMCea32gpmg"))
        self.assertTrue(is_live_ref("rtsp://192.168.1.10/stream"))
        self.assertFalse(is_live_ref("/tmp/clip.mp4"))

    def test_source_id(self):
        self.assertEqual(source_id("https://www.youtube.com/watch?v=zMCea32gpmg"), "yt_zMCea32gpmg")
        self.assertEqual(source_id("webcam:0"), "webcam_0")
        from pathlib import Path

        self.assertEqual(source_id(Path("/tmp/clips/barrier_bay.mp4")), "barrier_bay")

    def test_pick_youtube_prefers_720_hls(self):
        url = _pick_youtube_url(
            {
                "formats": [
                    {"url": "https://ex/1080.m3u8", "height": 1080, "vcodec": "avc1", "protocol": "m3u8_native"},
                    {"url": "https://ex/720.m3u8", "height": 720, "vcodec": "avc1", "protocol": "m3u8_native"},
                    {"url": "https://ex/360.m3u8", "height": 360, "vcodec": "avc1", "protocol": "m3u8_native"},
                ]
            }
        )
        self.assertEqual(url, "https://ex/720.m3u8")
