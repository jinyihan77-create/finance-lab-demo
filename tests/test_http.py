import http.client
import json
import tempfile
import threading
import unittest
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path
from assistant.service import Assistant
from assistant.storage import Store
from serve import Handler


class QuietHandler(Handler):
    def log_message(self,*args):pass


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        cls.server.assistant=Assistant(Store(Path(cls.tmp.name)/'session.sqlite'))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.tmp.cleanup()
    def request(self,method,path,body=None,headers=None):
        client=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        client.request(method,path,body=body,headers=headers or {})
        r=client.getresponse();result=(r.status,dict(r.getheaders()),r.read());client.close();return result
    def test_private_source_and_database_not_served(self):
        for path in ['/serve.py','/assistant/storage.py','/.git/config','/data/assistant.sqlite','/../finance-lab-demo/README.md']:
            with self.subTest(path=path):self.assertEqual(self.request('GET',path)[0],404)
    def test_main_entry_and_module_mime(self):
        status,headers,body=self.request('GET','/')
        self.assertEqual(status,200);self.assertIn(b'versions/conversation.js',body)
        status,headers,body=self.request('GET','/versions/conversation.js')
        self.assertEqual(status,200);self.assertIn('javascript',headers['Content-Type'])
    def test_cookie_session_and_persistence(self):
        status,headers,body=self.request('GET','/api/assistant/state')
        self.assertEqual(status,200)
        cookie=headers['Set-Cookie'];self.assertIn('HttpOnly',cookie);self.assertIn('SameSite=Strict',cookie);self.assertIn('Path=/api/assistant;',cookie)
        cookie=cookie.split(';')[0]
        payload=json.dumps(dict(text='今天午饭实付18元',request_id=uuid.uuid4().hex,thread_id=uuid.uuid4().hex)).encode()
        h={'Cookie':cookie,'Content-Type':'application/json','X-Finance-Request':'1'}
        self.assertEqual(self.request('POST','/api/assistant/message',payload,h)[0],200)
        for i in range(2):
            status,headers,body=self.request('POST','/api/assistant/message',payload,h)
            self.assertEqual(len(json.loads(body)['state']['records']),1)
        self.assertEqual(json.loads(self.request('GET','/api/assistant/state')[2])['state']['records'],[])
    def test_cross_origin_and_nonlocal_host_rejected(self):
        self.assertEqual(self.request('GET','/api/assistant/state',headers={'Origin':'https://example.com'})[0],403)
        self.assertEqual(self.request('GET','/api/assistant/state',headers={'Host':'untrusted.example'})[0],403)
        self.assertEqual(self.request('POST','/api/assistant/message','{}',{'Content-Type':'application/json'})[0],403)
    def test_invalid_payload_is_not_success(self):
        h={'Content-Type':'application/json','X-Finance-Request':'1'}
        for body in ['{}','[]','invalid-json']:
            self.assertEqual(self.request('POST','/api/assistant/message',body,h)[0],400)


if __name__=='__main__':unittest.main()
