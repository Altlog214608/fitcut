# 비용 할당 태그 (ROADMAP M0, M7 태그별 월 비용 리포트, ADR-047).
# envs/dev 리소스에 붙는 Project·Env·Component 태그를 결제 데이터에서 쓸 수 있게 켠다.
# 태그가 결제 데이터에 한 번 나타난 뒤에만 켤 수 있다(2026-10-14 확인). 켠 뒤 Cost Explorer에 반영되기까지 최대 24시간.
# 계정 단위 결제 설정이라 CI 역할에 권한을 주지 않고 bootstrap에 둔다.

resource "aws_ce_cost_allocation_tag" "this" {
  for_each = toset(["Project", "Env", "Component"])

  tag_key = each.value
  status  = "Active"
}
