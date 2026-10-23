import unittest
import test_conversation as baseline


class UserNeedsTests(unittest.TestCase):
    setUp=baseline.ConversationTests.setUp
    tearDown=baseline.ConversationTests.tearDown
    review=baseline.ConversationTests.review
    send=baseline.ConversationTests.send
    answer=baseline.ConversationTests.answer
    def test_record_only_skips_budget_but_keeps_missing_amount_questions(self):
        s=self.send('我只想记账，不要分析，回答简短一点。工资到账12000元，计划买入基金3000元')
        self.assertEqual(len(s['records']),2)
        self.assertEqual(s['profile']['workflow'],'record_only')
        self.assertEqual(s['profile']['response_style'],'brief')
        self.assertEqual(len(self.calls),0)
        self.assertIsNone(s['threads'][0]['pending'])
        s=self.send('今天订阅了GPT Pro')
        self.assertEqual(s['threads'][0]['pending']['kind'],'edit')
        s=self.send('200美元')
        self.assertEqual(s['records'][-1]['status'],'recorded')

    def test_budget_coach_and_switch_to_record_only(self):
        s=self.send('我想控制开支')
        self.assertEqual(s['profile']['workflow'],'budget_coach')
        self.assertEqual(s['threads'][0]['pending']['field'],'opening')
        s=self.send('以后只记账')
        self.assertIsNone(s['threads'][0]['pending'])

    def test_multiple_missing_amounts_resolved_in_order(self):
        s=self.send('工资到账了，午饭实付了，订阅了GPT Pro，计划买基金')
        self.assertEqual(len(s['records']),4)
        self.assertEqual(s['threads'][0]['pending']['id'],s['records'][0]['id'])
        for text in ('一万二千','十八元','200美元','计划3000元'):
            s=self.send(text)
        self.assertEqual([r['amount_cents'] for r in s['records']],[1200000,1800,20000,300000])
        self.assertEqual([r['status'] for r in s['records']],['recorded','recorded','recorded','plan'])
        self.assertEqual(len(s['records']),4)

    def test_skip_and_resume_pending_review(self):
        s=self.send('订阅了GPT Pro')
        s=self.send('跳过')
        self.assertIsNone(s['threads'][0]['pending'])
        s=self.send('午饭实付18元')
        self.assertIsNone(s['threads'][0]['pending'])
        s=self.send('继续核对')
        self.assertEqual(s['threads'][0]['pending']['id'],s['records'][0]['id'])

    def test_skip_old_question_does_not_mute_new_missing_payment(self):
        self.send('订阅了GPT Pro')
        self.send('跳过')
        s=self.send('工资到账了')
        self.assertEqual(s['threads'][0]['pending']['id'],s['records'][1]['id'])

    def test_one_off_memory_choice_does_not_disable_next_entry(self):
        s=self.send('这次不要记住。工资到账12000元，计划买基金3000元')
        self.assertEqual(len(s['records']),2)
        self.assertEqual(s['memories'],[])
        s=self.send('计划买纳斯达克2000元')
        self.assertEqual(len(s['memories']),1)

    def test_persistent_memory_policy_and_reset(self):
        self.send('以后不要记住')
        s=self.send('工资到账12000元')
        self.assertEqual(s['memories'],[])
        s=self.send('忘记我的偏好')
        self.assertEqual(s['profile'],{})
        self.assertEqual(s['memories'],[])

    def test_detailed_feedback_and_model_context(self):
        self.send('解释清楚，详细一点，我偏好低风险，闲钱三年不用')
        s=self.send('午饭实付18元')
        self.assertIn('餐饮支出：',self.answer(s)['text'])
        self.send('结合这些信息帮我分析')
        self.assertIn('详细解释依据',self.calls[-1][0])
        self.assertIn('低风险',self.calls[-1][0])

    def test_preference_isolation_and_no_demographic_inference(self):
        self.send('我想长期投资')
        self.assertEqual(self.app.state('alice')['profile']['workflow'],'investment_coach')
        self.assertEqual(self.app.state('bob')['profile'],{})
        s=self.send('我是学生，午饭花了20元')
        self.assertNotIn('学生',str(s['profile']))

    def test_negated_risk_and_quoted_preference_not_saved(self):
        s=self.send('我不喜欢高风险')
        self.assertNotIn('risk_preference',s['profile'])
        s=self.send('朋友说只想记账')
        self.assertNotIn('workflow',s['profile'])
        s=self.send('我不想长期投资')
        self.assertNotIn('workflow',s['profile'])

    def test_plain_language_without_punctuation_splits_subjects(self):
        s=self.send('工资到账12000元午饭实付18元订阅GPT Pro花了200美元计划买入基金3000元')
        self.assertEqual(len(s['records']),4)
        self.assertEqual([r['kind'] for r in s['records']],['income','expense','subscription','investment'])

    def test_preference_and_fact_without_comma_does_not_lose_payment(self):
        s=self.send('我只想记账午饭实付18元')
        self.assertEqual(len(s['records']),1)
        self.assertEqual(s['records'][0]['amount_cents'],1800)

    def test_targeted_correction_does_not_edit_pending_subscription(self):
        self.send('午饭实付18元，订阅了GPT Pro')
        s=self.send('午饭改成二十八')
        self.assertEqual(s['records'][0]['amount_cents'],2800)
        self.assertIsNone(s['records'][1]['amount_cents'])
        self.assertEqual(s['threads'][0]['pending']['id'],s['records'][1]['id'])

    def test_meal_disambiguation_and_yesterday(self):
        self.send('昨天午饭实付18元，今天午饭实付20元，今天晚饭实付30元')
        s=self.send('昨天午饭改成28元')
        self.assertEqual(s['records'][0]['amount_cents'],2800)
        s=self.send('今天晚饭改成35元')
        self.assertEqual(s['records'][2]['amount_cents'],3500)
        self.assertEqual(s['records'][1]['amount_cents'],2000)

    def test_category_summary_and_investment_export(self):
        import csv,io
        self.send('订阅GPT Pro花了200美元，午饭实付18元，计划买入基金3000元')
        s=self.send('订阅花了多少')
        self.assertIn('US$200.00',self.answer(s)['text'])
        self.assertNotIn('18.00',self.answer(s)['text'])
        rows=list(csv.reader(io.StringIO(self.app.export('alice','investment').decode('utf-8-sig'))))
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[1][2],'投资')

    def test_no_analysis_request_or_false_preference_cash_flow(self):
        s=self.send('我不需要投资建议，工资到账12000元')
        self.assertEqual(len(s['records']),1)
        self.assertEqual(len(self.calls),0)
        s=self.send('我想长期稳健投资')
        self.assertEqual(len(s['records']),1)
        self.assertEqual(s['profile']['workflow'],'investment_coach')

    def test_ambiguous_correction_returns_specific_choices_without_mutation(self):
        self.send('今天吃饭花了18元，今天吃饭花了28元')
        s=self.send('吃饭改成30元')
        self.assertEqual([r['amount_cents'] for r in s['records']],[1800,2800])
        self.assertEqual(len(self.answer(s)['actions']),2)
        self.assertEqual(self.answer(s)['actions'][0]['kind'],'edit')

    def test_positive_plan_status_followup(self):
        s=self.send('GPT会员200美元')
        s=self.send('只是计划')
        self.assertEqual(s['records'][0]['status'],'plan')

    def test_salary_added_after_ratio_plan_resolves_and_tracks_source(self):
        s=self.send('计划拿工资的30%投纳斯达克')
        self.assertIsNone(s['records'][0]['amount_cents'])
        s=self.send('工资到账12000元')
        self.assertEqual(s['records'][0]['amount_cents'],360000)
        self.assertEqual(s['records'][0]['status'],'plan')
        s=self.send('工资改成10000元')
        self.assertEqual(s['records'][0]['amount_cents'],300000)

    def test_navigation_export_delete_commands_do_not_create_records(self):
        for text in ['打开投资计划','查看记忆','导出投资计划','删除昨天的午饭']:
            s=self.send(text)
            self.assertEqual(s['records'],[])
            self.assertTrue(self.answer(s)['actions'])

    def test_fact_before_analysis_request_in_same_clause_is_kept(self):
        s=self.send('午饭实付18元请帮我分析')
        self.assertEqual(len(s['records']),1)
        self.assertEqual(s['records'][0]['amount_cents'],1800)
        self.assertEqual(len(self.calls),1)
