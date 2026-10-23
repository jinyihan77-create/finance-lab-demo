import unittest
from assistant.core_client import build_request,to_ui_response

class CoreContractTests(unittest.TestCase):
    def test_model_evidence_reads_live_contract_fields(self):
        response=to_ui_response(200,{'status':'PENDING_RISK','model':{'model_response':{'call_succeeded':True,'provider':'cloudflare_workers_ai','model':'example-model'}},'proposed_action':{'proposed_action':'HOLD_FOR_REVIEW','action_reason':'核对生活预留'},'risk_handoff':{'execution_allowed':False}})
        self.assertEqual(response['model']['name'],'example-model')
        self.assertEqual(response['recommendation']['reason'],'核对生活预留')
        self.assertFalse(response['execution_allowed'])
    def test_actual_user_reports_are_not_marked_as_fixtures(self):
        body=build_request('帮我分析',data_mode='LIVE')
        self.assertEqual(body['data_mode'],'LIVE')
        self.assertEqual(body['capability'],'REVIEW_ONLY')
        self.assertEqual(body['execution_mode'],'PAPER')

if __name__=='__main__':unittest.main()
